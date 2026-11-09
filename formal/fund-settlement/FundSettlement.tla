---------------------------- MODULE FundSettlement ----------------------------
(***************************************************************************)
(* Bond stake accounts, one settlement, and the instructions that move     *)
(* lamports between them. Lamports are small integers; warmup and cooldown *)
(* take one epoch. Fund = "current" models fund_settlement as deployed,    *)
(* Fund = "new" models the planned fix (withdrawable per the stake         *)
(* program, rejecting accounts not above the minimal size, keeping a       *)
(* leftover below the minimum delegation instead of splitting it, funding  *)
(* the whole account when the withdrawn surplus cannot be delegated, or    *)
(* would have to be while the vote account is closed, re-delegating on     *)
(* reset only to a live one).                                              *)
(***************************************************************************)
EXTENDS Integers, FiniteSets, TLC

CONSTANTS
    Accounts,          \* stake account slots
    Rent,              \* live rent of a stake account
    Pinned,            \* Meta.rent_exempt_reserve the stake program stores (>= Rent)
    MinStake,          \* config.minimum_stake_lamports = stake program minimum delegation
    Sizes,             \* lamports a bond stake account is funded with by fund_bond
    HandoverSizes,     \* lamports of an externally prepared account handed to the bond
    HandoverWithdraw,  \* lamports withdrawn from it while inactive, before the handover
    Claims,            \* max_total_claim of the settlement
    WithdrawAmounts,   \* amounts of withdraw requests
    Transfers,         \* lamports anyone sends to a bond stake account (transfer, MEV tips)
    MaxEpoch,
    MaxCustody,        \* bound on lamports brought into the bond, keeps the state space finite
    ClaimWindow,       \* config.epochs_to_claim_settlement
    Fund,              \* "current" | "new"
    WithdrawRequests,  \* TRUE enables claim_withdraw_request
    VoteClosed         \* closed vote account kinds: subset of {"system", "zeroed", "foreign"}

Inf == 1000
MinSize == MinStake + Pinned          \* minimal_size_stake_account
SplitRent == Rent                     \* Anchor `init` pays live rent for the split account
Min(x, y) == IF x <= y THEN x ELSE y

VARIABLES
    acc,       \* [Accounts -> account record]
    epoch,
    stl,       \* the settlement
    panicked,  \* an arithmetic panic aborted fund_settlement
    custody,   \* ghost: lamports under bond custody per the instructions applied
    vote       \* the bond's vote account: "live" or a kind of VoteClosed

vars == <<acc, epoch, stl, panicked, custody, vote>>

\* resetSkipped: ghost, reset_stake returned the account without re-delegating it
NoAccount == [exists |-> FALSE, lamports |-> 0, stake |-> 0, act |-> 0,
              deact |-> Inf, staker |-> "none", withdrawer |-> "none",
              origin |-> "none", resetSkipped |-> FALSE]

(*************************** stake program (S) ****************************)

Inactive(a) == acc[a].act = acc[a].deact \/ acc[a].deact < epoch

\* S1: delegation.stake counts as staked until the account is fully inactive
Staked(a) == IF Inactive(a) THEN 0 ELSE acc[a].stake

Withdrawable(a) == acc[a].lamports - Staked(a) - Rent

Healthy(a) == acc[a].stake <= acc[a].lamports - Rent

FullyActive(a) == acc[a].act < epoch /\ acc[a].deact = Inf

\* S2: account record of the split destination, or an empty set when the stake program rejects;
\* the destination keeps the source origin, so a leftover of an external account stays external
SplitDest(a, amount) ==
    IF Inactive(a)
    THEN {[acc[a] EXCEPT !.lamports = amount]}
    ELSE IF amount >= MinStake /\ acc[a].stake - amount >= MinStake
    THEN {[acc[a] EXCEPT !.lamports = amount, !.stake = amount, !.resetSkipped = FALSE]}
    ELSE {}

SplitSourceStake(a, amount) ==
    IF Inactive(a) THEN acc[a].stake ELSE acc[a].stake - amount

\* S4 on an inactive account: a brand-new delegation of everything above rent
Delegated(r) == [r EXCEPT !.stake = r.lamports - Rent, !.act = epoch, !.deact = Inf,
                          !.resetSkipped = FALSE]

(****************************** predicates ********************************)

BondFree(a) == acc[a].exists /\ acc[a].staker = "bond" /\ acc[a].withdrawer = "bond"
Funded(a) == acc[a].exists /\ acc[a].staker = "settlement" /\ acc[a].withdrawer = "bond"
Free == {a \in Accounts : ~acc[a].exists}

\* the stake program delegates only to a vote-owned account with a non-zero version tag
Delegatable == vote = "live"

RECURSIVE SumLamports(_)
SumLamports(S) ==
    IF S = {} THEN 0
    ELSE LET x == CHOOSE x \in S : TRUE IN acc[x].lamports + SumLamports(S \ {x})

Deactivate(r) == IF r.deact = Inf THEN [r EXCEPT !.deact = epoch] ELSE r

ToSettlement(r) == [Deactivate(r) EXCEPT !.staker = "settlement"]

(********************************* init ***********************************)

Init ==
    /\ acc = [a \in Accounts |-> NoAccount]
    /\ epoch = 0
    /\ stl = [state |-> "none", max |-> 0, funded |-> 0, claimed |-> 0,
              created |-> 0, collector |-> FALSE, splitRent |-> 0, wholeForced |-> FALSE]
    /\ panicked = FALSE
    /\ custody = 0
    /\ vote = "live"

(**************************** environment *********************************)

\* fund_bond of a freshly delegated account
FundBond(a, size) ==
    /\ Delegatable
    /\ a \in Free
    /\ size - Rent >= MinStake
    /\ custody + size <= MaxCustody
    /\ acc' = [acc EXCEPT ![a] = [NoAccount EXCEPT !.exists = TRUE, !.lamports = size,
                  !.stake = size - Rent, !.act = epoch, !.deact = Inf,
                  !.staker = "bond", !.withdrawer = "bond", !.origin = "program"]]
    /\ custody' = custody + size
    /\ UNCHANGED <<epoch, stl, panicked, vote>>

\* delegated, deactivated in the same epoch, partly withdrawn, then authorized to the bond
HandoverUnderwater(a, size, withdrawn) ==
    /\ Delegatable
    /\ a \in Free
    /\ size - Rent >= MinStake
    /\ size - withdrawn >= Rent
    /\ custody + size - withdrawn <= MaxCustody
    /\ acc' = [acc EXCEPT ![a] = [NoAccount EXCEPT !.exists = TRUE,
                  !.lamports = size - withdrawn, !.stake = size - Rent, !.act = epoch,
                  !.deact = epoch, !.staker = "bond", !.withdrawer = "bond",
                  !.origin = "external"]]
    /\ custody' = custody + size - withdrawn
    /\ UNCHANGED <<epoch, stl, panicked, vote>>

\* stake program DeactivateDelinquent, permissionless once the validator stops voting
DeactivateDelinquent(a) ==
    /\ Delegatable
    /\ BondFree(a)
    /\ acc[a].deact = Inf
    /\ acc' = [acc EXCEPT ![a].deact = epoch]
    /\ UNCHANGED <<epoch, stl, panicked, custody, vote>>

\* plain lamports land on a bond stake account as non-delegated surplus
Transfer(a, amount) ==
    /\ BondFree(a)
    /\ custody + amount <= MaxCustody
    /\ acc' = [acc EXCEPT ![a].lamports = @ + amount]
    /\ custody' = custody + amount
    /\ UNCHANGED <<epoch, stl, panicked, vote>>

AdvanceEpoch ==
    /\ epoch < MaxEpoch
    /\ epoch' = epoch + 1
    /\ UNCHANGED <<acc, stl, panicked, custody, vote>>

(*************************** bonds program ********************************)

InitSettlement(claim) ==
    /\ stl.state = "none"
    /\ stl' = [stl EXCEPT !.state = "open", !.max = claim, !.created = epoch]
    /\ UNCHANGED <<acc, epoch, panicked, custody, vote>>

Panic ==
    /\ panicked' = TRUE
    /\ UNCHANGED <<acc, epoch, stl, custody, vote>>

\* fund_settlement.rs process(); a failed stake program CPI leaves no step
FundSettlement(a) ==
    /\ stl.state = "open"
    /\ BondFree(a)
    /\ ~panicked
    /\ Fund = "new" \/ vote \in {"live", "zeroed"}                  \* current: owner = vote program
    /\ IF stl.funded >= stl.max THEN UNCHANGED vars \* F9 no-op
       ELSE
       LET L == acc[a].lamports
           claim == stl.max - stl.funded
           need == claim + MinSize
           splittable == L > need /\ L - need >= MinSize + SplitRent
           delegated == IF Fund = "new" /\ Inactive(a) THEN 0 ELSE acc[a].stake
           nonDelegated == L - delegated
           leftover0 == L - need - SplitRent
           excess == IF nonDelegated > claim + Pinned THEN nonDelegated - claim - Pinned ELSE 0
           withdrawn == Min(excess, leftover0)
           \* the stake program rejects an active split below the minimum delegation
           leftover == IF Fund = "new" /\ leftover0 - withdrawn < MinStake
                       THEN 0 ELSE leftover0 - withdrawn
           delegatable == leftover > 0 \/ SplitRent + withdrawn - Rent >= MinStake
           \* delegating the withdrawn surplus needs a live vote account, a split does not
           voteForced == Fund = "new" /\ splittable /\ delegatable /\ ~Delegatable /\ leftover = 0
           whole == ~splittable \/ (Fund = "new" /\ ~delegatable) \/ voteForced
       IN
       IF whole THEN
           \* whole account
           IF Fund = "current" /\ L < MinSize THEN Panic                   \* :200
           ELSE IF Fund = "new" /\ L <= MinSize THEN FALSE                  \* error 6083
           ELSE /\ acc' = [acc EXCEPT ![a] = ToSettlement(acc[a])]
                /\ stl' = [stl EXCEPT !.funded = stl.funded + L - MinSize,
                                      !.wholeForced = stl.wholeForced \/ voteForced]
                /\ UNCHANGED <<epoch, panicked, custody, vote>>
       ELSE IF stl.collector THEN FALSE                                     \* error 6079
       ELSE IF Fund = "current" /\ L < acc[a].stake THEN Panic              \* :233
       ELSE
       /\ withdrawn <= Withdrawable(a)
       /\ \E b \in Free :
           LET dests ==
                 IF leftover > 0
                 THEN {[d EXCEPT !.lamports = SplitRent + withdrawn + leftover]
                        : d \in SplitDest(a, leftover)}
                 \* the delegate CPI fails on a vote account that cannot be delegated to
                 ELSE IF Delegatable /\ SplitRent + withdrawn - Rent >= MinStake
                 THEN {Delegated([acc[a] EXCEPT !.lamports = SplitRent + withdrawn,
                                  !.staker = "bond", !.origin = "program"])}
                 ELSE {}
           IN \E dest \in dests :
              /\ acc' = [acc EXCEPT
                     ![a] = ToSettlement([acc[a] EXCEPT
                              !.lamports = L - withdrawn - leftover,
                              !.stake = IF leftover > 0
                                        THEN SplitSourceStake(a, leftover)
                                        ELSE acc[a].stake]),
                     ![b] = [dest EXCEPT !.staker = "bond", !.withdrawer = "bond"]]
              /\ stl' = [stl EXCEPT !.collector = TRUE,
                                    !.funded = stl.funded + L - withdrawn - leftover - MinSize - SplitRent,
                                    !.splitRent = SplitRent]
              /\ custody' = custody + SplitRent
              /\ UNCHANGED <<epoch, panicked, vote>>

\* claim_settlement_v2 paying `amount` from one funded account
ClaimSettlement(a, amount) ==
    /\ stl.state = "open"
    /\ Funded(a)
    /\ stl.claimed + amount <= stl.max
    /\ acc[a].lamports >= amount + MinSize \/ acc[a].lamports = amount
    /\ amount <= Withdrawable(a) \/ (Staked(a) = 0 /\ amount = acc[a].lamports)
    /\ acc' = [acc EXCEPT ![a].lamports = @ - amount]
    /\ stl' = [stl EXCEPT !.claimed = @ + amount]
    /\ custody' = custody - amount
    /\ UNCHANGED <<epoch, panicked, vote>>

\* close_settlement_v2 refunding the split rent from a funded account
CloseSettlement(a) ==
    /\ stl.state = "open"
    /\ epoch > stl.created + ClaimWindow
    /\ IF stl.collector
       THEN /\ Funded(a)
            /\ stl.splitRent <= Withdrawable(a)
            /\ acc' = [acc EXCEPT ![a].lamports = @ - stl.splitRent]
            /\ custody' = custody - stl.splitRent
       ELSE UNCHANGED <<acc, custody>>
    /\ stl' = [stl EXCEPT !.state = "closed"]
    /\ UNCHANGED <<epoch, panicked, vote>>

\* reset_stake: back to the bond, re-delegated when deactivated and the vote account allows it
ResetStake(a) ==
    /\ stl.state = "closed"
    /\ Funded(a)
    /\ Fund = "new" \/ vote # "foreign"                             \* current: owner in {vote, system}
    /\ LET r == [acc[a] EXCEPT !.staker = "bond", !.origin = "program"] IN
       IF r.deact = Inf THEN acc' = [acc EXCEPT ![a] = r]
       ELSE IF Delegatable THEN
            IF Inactive(a)
            THEN /\ r.lamports - Rent >= MinStake
                 /\ acc' = [acc EXCEPT ![a] = Delegated(r)]
            ELSE /\ r.lamports - Rent >= r.stake   \* S4 rescind in the deactivation epoch
                 /\ acc' = [acc EXCEPT ![a] = [r EXCEPT !.deact = Inf]]
       ELSE IF Fund = "current" /\ vote = "zeroed" THEN FALSE        \* current: the delegate CPI fails
       ELSE acc' = [acc EXCEPT ![a] = [r EXCEPT !.resetSkipped = TRUE]]
    /\ UNCHANGED <<epoch, stl, panicked, custody, vote>>

\* merge_stake (S3): fully inactive pair, or fully active pair
MergeStake(d, s) ==
    /\ d # s
    /\ BondFree(d) /\ BondFree(s)
    /\ \/ Inactive(d) /\ Inactive(s)
       \/ FullyActive(d) /\ FullyActive(s)
    /\ acc' = [acc EXCEPT
           ![d] = [@ EXCEPT !.lamports = @ + acc[s].lamports,
                            !.stake = IF Inactive(d) THEN @ ELSE @ + acc[s].stake,
                            !.resetSkipped = IF Inactive(d) THEN @ ELSE @ \/ acc[s].resetSkipped],
           ![s] = NoAccount]
    /\ UNCHANGED <<epoch, stl, panicked, custody, vote>>

\* claim_withdraw_request: the requested amount leaves, the leftover is split off and stays
ClaimWithdrawRequest(a, amount) ==
    /\ WithdrawRequests
    /\ BondFree(a)
    /\ IF acc[a].lamports > amount
       THEN LET rest == acc[a].lamports - amount IN
            /\ rest >= MinSize
            /\ amount >= MinSize
            /\ \E b \in Free : \E dest \in SplitDest(a, rest) :
                 /\ acc' = [acc EXCEPT
                        ![b] = [dest EXCEPT !.lamports = SplitRent + rest],
                        ![a] = NoAccount]
                 /\ custody' = custody + SplitRent - amount
       ELSE /\ acc' = [acc EXCEPT ![a] = NoAccount]
            /\ custody' = custody - acc[a].lamports
    /\ UNCHANGED <<epoch, stl, panicked, vote>>

(**************************** vote account ********************************)

\* the validator closes its vote account at any time, or re-creates the address under any owner
CloseVoteAccount(kind) ==
    /\ kind \in VoteClosed
    /\ kind # vote
    /\ vote' = kind
    /\ UNCHANGED <<acc, epoch, stl, panicked, custody>>

\* the address becomes a vote account again (re-created or a zeroed one initialized)
ReopenVoteAccount ==
    /\ vote # "live"
    /\ vote' = "live"
    /\ UNCHANGED <<acc, epoch, stl, panicked, custody>>

Next ==
    \/ \E a \in Accounts, s \in Sizes : FundBond(a, s)
    \/ \E a \in Accounts, s \in HandoverSizes, w \in HandoverWithdraw :
         HandoverUnderwater(a, s, w)
    \/ \E a \in Accounts : DeactivateDelinquent(a)
    \/ \E a \in Accounts, x \in Transfers : Transfer(a, x)
    \/ AdvanceEpoch
    \/ \E c \in Claims : InitSettlement(c)
    \/ \E a \in Accounts : FundSettlement(a)
    \/ \E a \in Accounts, x \in 1..stl.max : ClaimSettlement(a, x)
    \/ \E a \in Accounts : CloseSettlement(a)
    \/ \E a \in Accounts : ResetStake(a)
    \/ \E d, s \in Accounts : MergeStake(d, s)
    \/ \E a \in Accounts, x \in WithdrawAmounts : ClaimWithdrawRequest(a, x)
    \/ \E k \in VoteClosed : CloseVoteAccount(k)
    \/ ReopenVoteAccount

Spec == Init /\ [][Next]_vars

Perms == Permutations(Accounts)

(****************************** invariants ********************************)

\* F1
NoPanic == ~panicked

\* L2: an account the program produced and left in the bond is never underwater, except one
\* reset_stake returned without re-delegating because the vote account was closed
NoProgramMadeUnderwater ==
    \A a \in Accounts :
        BondFree(a) /\ acc[a].origin = "program" /\ ~acc[a].resetSkipped => Healthy(a)

\* F2: a whole account funded only because the vote account is closed may overfund without bound
OverfundBounded ==
    stl.state = "none" \/ stl.wholeForced \/
    stl.funded - stl.max < (IF Fund = "new" THEN 2 * MinStake ELSE MinSize) + SplitRent

\* L4: every account under bond custody keeps a delegation to the bond's vote account
Attributed == \A a \in Accounts : acc[a].exists => acc[a].stake > 0

\* L5: a closed vote account never blocks returning funded stake to the bond
ResetPossible ==
    \A a \in Accounts : (stl.state = "closed" /\ Funded(a) /\ ~Delegatable) => ENABLED ResetStake(a)

\* L1
CustodyConserved ==
    SumLamports({a \in Accounts : acc[a].exists /\ acc[a].withdrawer = "bond"}) = custody

\* F4: funded accounts can pay every funded claim and keep the minimal size
ClaimsPayable ==
    stl.state # "open" \/
    LET owed == IF stl.funded < stl.max THEN stl.funded ELSE stl.max
        payable == SumLamports({a \in Accounts : Funded(a)})
                   - MinSize * Cardinality({a \in Accounts : Funded(a)})
    IN payable >= owed - stl.claimed

\* L3 (safety form): an open underfunded settlement can be funded from any bond account above
\* the minimal size; a fund_settlement that fails deterministically stalls every pipeline run
FundingPossible ==
    \A a \in Accounts :
        (stl.state = "open" /\ stl.funded < stl.max /\ ~panicked /\ Free # {}
         /\ BondFree(a) /\ acc[a].lamports > MinSize)
        => ENABLED FundSettlement(a)

\* F7: the split rent can be refunded on close
RefundAvailable ==
    ~(stl.state = "open" /\ stl.collector) \/
    \E a \in Accounts : Funded(a) /\ acc[a].lamports >= stl.splitRent + Rent

=============================================================================
