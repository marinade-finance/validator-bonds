/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/validator_bonds.json`.
 */
export type ValidatorBonds = {
  address: 'vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4'
  metadata: {
    name: 'validatorBonds'
    version: '2.1.0'
    spec: '0.1.0'
  }
  instructions: [
    {
      name: 'initConfig'
      discriminator: [23, 235, 115, 232, 168, 96, 1, 231]
      accounts: [
        {
          name: 'config'
          writable: true
          signer: true
        },
        {
          name: 'rentPayer'
          docs: ['rent exempt payer for the config account']
          writable: true
          signer: true
        },
        {
          name: 'systemProgram'
        },
        {
          name: 'eventAuthority'
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                  34,
                ]
              },
            ]
          }
        },
        {
          name: 'program'
        },
      ]
      args: [
        {
          name: 'initConfigArgs'
          type: {
            defined: {
              name: 'initConfigArgs'
            }
          }
        },
      ]
    },
    {
      name: 'configureConfig'
      discriminator: [198, 98, 161, 165, 137, 200, 230, 203]
      accounts: [
        {
          name: 'config'
          writable: true
          relations: ['adminAuthority']
        },
        {
          name: 'adminAuthority'
          docs: ['only the admin authority can change the config params']
          signer: true
        },
        {
          name: 'eventAuthority'
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                  34,
                ]
              },
            ]
          }
        },
        {
          name: 'program'
        },
      ]
      args: [
        {
          name: 'configureConfigArgs'
          type: {
            defined: {
              name: 'configureConfigArgs'
            }
          }
        },
      ]
    },
    {
      name: 'initBond'
      discriminator: [95, 93, 93, 181, 221, 36, 126, 64]
      accounts: [
        {
          name: 'config'
          docs: ['the config account under which the bond is created']
        },
        {
          name: 'voteAccount'
        },
        {
          name: 'validatorIdentity'
          docs: [
            'permission-ed: the validator identity signs the instruction, InitBondArgs applied',
            'permission-less: no signature, default init bond configuration',
          ]
          signer: true
          optional: true
        },
        {
          name: 'bond'
          writable: true
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  98,
                  111,
                  110,
                  100,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'config'
                account: 'config'
              },
              {
                kind: 'account'
                path: 'voteAccount'
              },
            ]
          }
        },
        {
          name: 'rentPayer'
          docs: ['rent exempt payer of validator bond account creation']
          writable: true
          signer: true
        },
        {
          name: 'systemProgram'
        },
        {
          name: 'eventAuthority'
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                  34,
                ]
              },
            ]
          }
        },
        {
          name: 'program'
        },
      ]
      args: [
        {
          name: 'initBondArgs'
          type: {
            defined: {
              name: 'initBondArgs'
            }
          }
        },
      ]
    },
    {
      name: 'configureBond'
      discriminator: [228, 108, 79, 242, 82, 54, 105, 65]
      accounts: [
        {
          name: 'config'
        },
        {
          name: 'bond'
          writable: true
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  98,
                  111,
                  110,
                  100,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'config'
                account: 'config'
              },
              {
                kind: 'account'
                path: 'voteAccount'
              },
            ]
          }
          relations: ['voteAccount', 'config']
        },
        {
          name: 'authority'
          docs: [
            'validator vote account validator identity or bond authority may change the account',
          ]
          signer: true
        },
        {
          name: 'voteAccount'
        },
        {
          name: 'eventAuthority'
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                  34,
                ]
              },
            ]
          }
        },
        {
          name: 'program'
        },
      ]
      args: [
        {
          name: 'configureBondArgs'
          type: {
            defined: {
              name: 'configureBondArgs'
            }
          }
        },
      ]
    },
    {
      name: 'configureBondWithMint'
      discriminator: [48, 189, 230, 39, 112, 33, 227, 8]
      accounts: [
        {
          name: 'config'
        },
        {
          name: 'bond'
          writable: true
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  98,
                  111,
                  110,
                  100,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'config'
                account: 'config'
              },
              {
                kind: 'account'
                path: 'voteAccount'
              },
            ]
          }
          relations: ['config', 'voteAccount']
        },
        {
          name: 'mint'
          writable: true
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [34, 98, 111, 110, 100, 95, 109, 105, 110, 116, 34]
              },
              {
                kind: 'account'
                path: 'bond'
                account: 'bond'
              },
              {
                kind: 'arg'
                path: 'params.validator_identity'
              },
            ]
          }
        },
        {
          name: 'voteAccount'
        },
        {
          name: 'tokenAccount'
          docs: ['token account to burn bond mint configuration tokens from']
          writable: true
        },
        {
          name: 'tokenAuthority'
          signer: true
        },
        {
          name: 'tokenProgram'
        },
        {
          name: 'eventAuthority'
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                  34,
                ]
              },
            ]
          }
        },
        {
          name: 'program'
        },
      ]
      args: [
        {
          name: 'args'
          type: {
            defined: {
              name: 'configureBondWithMintArgs'
            }
          }
        },
      ]
    },
    {
      name: 'mintBond'
      discriminator: [234, 94, 85, 225, 167, 102, 169, 32]
      accounts: [
        {
          name: 'config'
        },
        {
          name: 'bond'
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  98,
                  111,
                  110,
                  100,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'config'
                account: 'config'
              },
              {
                kind: 'account'
                path: 'voteAccount'
              },
            ]
          }
          relations: ['config', 'voteAccount']
        },
        {
          name: 'mint'
          writable: true
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [34, 98, 111, 110, 100, 95, 109, 105, 110, 116, 34]
              },
              {
                kind: 'account'
                path: 'bond'
                account: 'bond'
              },
              {
                kind: 'account'
                path: 'validatorIdentity'
              },
            ]
          }
        },
        {
          name: 'validatorIdentity'
        },
        {
          name: 'validatorIdentityTokenAccount'
          writable: true
        },
        {
          name: 'voteAccount'
        },
        {
          name: 'metadata'
          writable: true
        },
        {
          name: 'rentPayer'
          docs: ['rent exempt payer of account creation']
          writable: true
          signer: true
        },
        {
          name: 'systemProgram'
        },
        {
          name: 'tokenProgram'
        },
        {
          name: 'associatedTokenProgram'
        },
        {
          name: 'metadataProgram'
        },
        {
          name: 'rent'
        },
        {
          name: 'eventAuthority'
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                  34,
                ]
              },
            ]
          }
        },
        {
          name: 'program'
        },
      ]
      args: []
    },
    {
      name: 'fundBond'
      discriminator: [58, 44, 212, 175, 30, 17, 68, 62]
      accounts: [
        {
          name: 'config'
        },
        {
          name: 'bond'
          docs: [
            'bond account to be deposited to with the provided stake account',
          ]
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  98,
                  111,
                  110,
                  100,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'config'
                account: 'config'
              },
              {
                kind: 'account'
                path: 'bond.vote_account'
                account: 'bond'
              },
            ]
          }
          relations: ['config']
        },
        {
          name: 'bondsWithdrawerAuthority'
          docs: [
            "new owner of the stake_account, it's the bonds withdrawer authority",
          ]
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  98,
                  111,
                  110,
                  100,
                  115,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'config'
                account: 'config'
              },
            ]
          }
        },
        {
          name: 'stakeAccount'
          docs: ['stake account to be deposited']
          writable: true
        },
        {
          name: 'stakeAuthority'
          docs: [
            'authority signature permitting to change the stake_account authorities',
          ]
          signer: true
        },
        {
          name: 'clock'
        },
        {
          name: 'stakeHistory'
        },
        {
          name: 'stakeProgram'
        },
        {
          name: 'eventAuthority'
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                  34,
                ]
              },
            ]
          }
        },
        {
          name: 'program'
        },
      ]
      args: []
    },
    {
      name: 'initWithdrawRequest'
      discriminator: [142, 31, 222, 215, 83, 79, 34, 49]
      accounts: [
        {
          name: 'config'
          docs: ['the config account under which the bond was created']
        },
        {
          name: 'bond'
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  98,
                  111,
                  110,
                  100,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'config'
                account: 'config'
              },
              {
                kind: 'account'
                path: 'voteAccount'
              },
            ]
          }
          relations: ['config', 'voteAccount']
        },
        {
          name: 'voteAccount'
        },
        {
          name: 'authority'
          docs: [
            'validator vote account node identity or bond authority may ask for the withdrawal',
          ]
          signer: true
        },
        {
          name: 'withdrawRequest'
          writable: true
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  119,
                  105,
                  116,
                  104,
                  100,
                  114,
                  97,
                  119,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'bond'
                account: 'bond'
              },
            ]
          }
        },
        {
          name: 'rentPayer'
          docs: ['rent exempt payer of withdraw request account creation']
          writable: true
          signer: true
        },
        {
          name: 'systemProgram'
        },
        {
          name: 'eventAuthority'
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                  34,
                ]
              },
            ]
          }
        },
        {
          name: 'program'
        },
      ]
      args: [
        {
          name: 'createWithdrawRequestArgs'
          type: {
            defined: {
              name: 'initWithdrawRequestArgs'
            }
          }
        },
      ]
    },
    {
      name: 'cancelWithdrawRequest'
      discriminator: [167, 100, 110, 128, 113, 154, 224, 77]
      accounts: [
        {
          name: 'config'
        },
        {
          name: 'bond'
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  98,
                  111,
                  110,
                  100,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'config'
                account: 'config'
              },
              {
                kind: 'account'
                path: 'voteAccount'
              },
            ]
          }
          relations: ['voteAccount', 'config']
        },
        {
          name: 'voteAccount'
        },
        {
          name: 'authority'
          docs: [
            'validator vote account validator identity or bond authority may ask for cancelling',
          ]
          signer: true
        },
        {
          name: 'withdrawRequest'
          writable: true
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  119,
                  105,
                  116,
                  104,
                  100,
                  114,
                  97,
                  119,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'bond'
                account: 'bond'
              },
            ]
          }
          relations: ['bond']
        },
        {
          name: 'rentCollector'
          writable: true
        },
        {
          name: 'eventAuthority'
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                  34,
                ]
              },
            ]
          }
        },
        {
          name: 'program'
        },
      ]
      args: []
    },
    {
      name: 'claimWithdrawRequest'
      discriminator: [48, 232, 23, 52, 20, 134, 122, 118]
      accounts: [
        {
          name: 'config'
          docs: ['the config root configuration account']
        },
        {
          name: 'bond'
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  98,
                  111,
                  110,
                  100,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'config'
                account: 'config'
              },
              {
                kind: 'account'
                path: 'voteAccount'
              },
            ]
          }
          relations: ['config', 'voteAccount']
        },
        {
          name: 'voteAccount'
        },
        {
          name: 'authority'
          docs: [
            'validator vote account node identity or bond authority may claim',
          ]
          signer: true
        },
        {
          name: 'withdrawRequest'
          writable: true
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  119,
                  105,
                  116,
                  104,
                  100,
                  114,
                  97,
                  119,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'bond'
                account: 'bond'
              },
            ]
          }
          relations: ['voteAccount', 'bond']
        },
        {
          name: 'bondsWithdrawerAuthority'
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  98,
                  111,
                  110,
                  100,
                  115,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'config'
                account: 'config'
              },
            ]
          }
        },
        {
          name: 'stakeAccount'
          docs: [
            'stake account to be used to withdraw the funds',
            'this stake account has to be delegated to the validator vote account associated to the bond',
          ]
          writable: true
        },
        {
          name: 'withdrawer'
          docs: [
            'New owner of the stake account, it will be accounted to the withdrawer authority',
          ]
        },
        {
          name: 'splitStakeAccount'
          docs: [
            'this is a whatever address that does not exist',
            'when withdrawing needs to split the provided account this will be used as a new stake account',
          ]
          writable: true
          signer: true
        },
        {
          name: 'splitStakeRentPayer'
          docs: [
            'when the split_stake_account is created the rent for creation is taken from here',
            'when the split_stake_account is not created then no rent is paid',
          ]
          writable: true
          signer: true
        },
        {
          name: 'stakeProgram'
        },
        {
          name: 'systemProgram'
        },
        {
          name: 'stakeHistory'
        },
        {
          name: 'clock'
        },
        {
          name: 'eventAuthority'
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                  34,
                ]
              },
            ]
          }
        },
        {
          name: 'program'
        },
      ]
      args: []
    },
    {
      name: 'initSettlement'
      discriminator: [152, 178, 0, 65, 52, 210, 247, 58]
      accounts: [
        {
          name: 'config'
          relations: ['operatorAuthority']
        },
        {
          name: 'bond'
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  98,
                  111,
                  110,
                  100,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'config'
                account: 'config'
              },
              {
                kind: 'account'
                path: 'bond.vote_account'
                account: 'bond'
              },
            ]
          }
          relations: ['config']
        },
        {
          name: 'settlement'
          writable: true
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  115,
                  101,
                  116,
                  116,
                  108,
                  101,
                  109,
                  101,
                  110,
                  116,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'bond'
                account: 'bond'
              },
              {
                kind: 'arg'
                path: 'params.merkle_root'
              },
              {
                kind: 'arg'
                path: 'params.epoch'
              },
            ]
          }
        },
        {
          name: 'settlementClaims'
          writable: true
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  99,
                  108,
                  97,
                  105,
                  109,
                  115,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'settlement'
                account: 'settlement'
              },
            ]
          }
        },
        {
          name: 'operatorAuthority'
          docs: [
            'operator signer authority that is allowed to create the settlement account',
          ]
          signer: true
        },
        {
          name: 'rentPayer'
          docs: ['rent exempt payer of account creation']
          writable: true
          signer: true
        },
        {
          name: 'systemProgram'
        },
        {
          name: 'eventAuthority'
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                  34,
                ]
              },
            ]
          }
        },
        {
          name: 'program'
        },
      ]
      args: [
        {
          name: 'initSettlementArgs'
          type: {
            defined: {
              name: 'initSettlementArgs'
            }
          }
        },
      ]
    },
    {
      name: 'upsizeSettlementClaims'
      discriminator: [207, 46, 34, 88, 141, 36, 63, 132]
      accounts: [
        {
          name: 'settlementClaims'
          writable: true
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  99,
                  108,
                  97,
                  105,
                  109,
                  115,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'settlement_claims.settlement'
                account: 'settlementClaims'
              },
            ]
          }
        },
        {
          name: 'rentPayer'
          docs: ['rent exempt payer of account reallocation']
          writable: true
          signer: true
        },
        {
          name: 'systemProgram'
        },
      ]
      args: []
    },
    {
      name: 'cancelSettlement'
      discriminator: [33, 241, 96, 62, 228, 178, 1, 120]
      accounts: [
        {
          name: 'config'
          writable: true
        },
        {
          name: 'bond'
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  98,
                  111,
                  110,
                  100,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'config'
                account: 'config'
              },
              {
                kind: 'account'
                path: 'bond.vote_account'
                account: 'bond'
              },
            ]
          }
          relations: ['config']
        },
        {
          name: 'settlement'
          docs: ['settlement to close whenever the operator decides']
          writable: true
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  115,
                  101,
                  116,
                  116,
                  108,
                  101,
                  109,
                  101,
                  110,
                  116,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'bond'
                account: 'bond'
              },
              {
                kind: 'account'
                path: 'settlement.merkle_root'
                account: 'settlement'
              },
              {
                kind: 'account'
                path: 'settlement.epoch_created_for'
                account: 'settlement'
              },
            ]
          }
          relations: ['bond', 'rentCollector']
        },
        {
          name: 'settlementClaims'
          writable: true
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  99,
                  108,
                  97,
                  105,
                  109,
                  115,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'settlement'
                account: 'settlement'
              },
            ]
          }
          relations: ['settlement']
        },
        {
          name: 'authority'
          docs: [
            'Cancelling is permitted only to emergency or operator authority',
          ]
          signer: true
        },
        {
          name: 'bondsWithdrawerAuthority'
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  98,
                  111,
                  110,
                  100,
                  115,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'config'
                account: 'config'
              },
            ]
          }
        },
        {
          name: 'rentCollector'
          writable: true
        },
        {
          name: 'splitRentCollector'
          writable: true
        },
        {
          name: 'splitRentRefundAccount'
          docs: [
            "The stake account is funded to the settlement and credited to the bond's validator vote account.",
            'The lamports are utilized to pay back the rent exemption of the split_stake_account',
          ]
          writable: true
        },
        {
          name: 'clock'
        },
        {
          name: 'stakeProgram'
        },
        {
          name: 'stakeHistory'
        },
        {
          name: 'eventAuthority'
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                  34,
                ]
              },
            ]
          }
        },
        {
          name: 'program'
        },
      ]
      args: []
    },
    {
      name: 'fundSettlement'
      discriminator: [179, 146, 113, 34, 30, 92, 26, 19]
      accounts: [
        {
          name: 'config'
          relations: ['operatorAuthority']
        },
        {
          name: 'bond'
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  98,
                  111,
                  110,
                  100,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'config'
                account: 'config'
              },
              {
                kind: 'account'
                path: 'voteAccount'
              },
            ]
          }
          relations: ['config', 'voteAccount']
        },
        {
          name: 'voteAccount'
        },
        {
          name: 'settlement'
          writable: true
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  115,
                  101,
                  116,
                  116,
                  108,
                  101,
                  109,
                  101,
                  110,
                  116,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'bond'
                account: 'bond'
              },
              {
                kind: 'account'
                path: 'settlement.merkle_root'
                account: 'settlement'
              },
              {
                kind: 'account'
                path: 'settlement.epoch_created_for'
                account: 'settlement'
              },
            ]
          }
          relations: ['bond']
        },
        {
          name: 'operatorAuthority'
          docs: [
            'operator signer authority is allowed to fund the settlement account',
          ]
          signer: true
        },
        {
          name: 'stakeAccount'
          docs: ['stake account to be funded into the settlement']
          writable: true
        },
        {
          name: 'settlementStakerAuthority'
          docs: [
            'the settlement stake authority differentiates between deposited and funded stake accounts',
            'deposited accounts have the bonds_withdrawer_authority, while funded accounts have the settlement_staker_authority',
          ]
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  115,
                  101,
                  116,
                  116,
                  108,
                  101,
                  109,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'settlement'
                account: 'settlement'
              },
            ]
          }
        },
        {
          name: 'bondsWithdrawerAuthority'
          docs: [
            'authority that manages (owns) all stakes account under the bonds program',
          ]
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  98,
                  111,
                  110,
                  100,
                  115,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'config'
                account: 'config'
              },
            ]
          }
        },
        {
          name: 'splitStakeAccount'
          docs: [
            'if an account that does not exist is provided, it will be initialized as a stake account (with the necessary signature)',
            'the split_stake_account is required when the provided stake_account contains more lamports than necessary to fund the settlement',
            'in this case, the excess lamports from the stake account are split into the new split_stake_account,',
            'if the split_stake_account is not needed, the rent payer is refunded back within tx',
          ]
          writable: true
          signer: true
        },
        {
          name: 'splitStakeRentPayer'
          docs: [
            'the rent exempt payer of the split_stake_account creation',
            'if the split_stake_account is not needed (no leftover lamports on funding), then the rent payer is refunded',
            'if the split_stake_account is needed to spill out over funding of the settlement,',
            'then the rent payer is refunded when the settlement is closed',
          ]
          writable: true
          signer: true
        },
        {
          name: 'systemProgram'
        },
        {
          name: 'stakeHistory'
        },
        {
          name: 'clock'
        },
        {
          name: 'rent'
        },
        {
          name: 'stakeProgram'
        },
        {
          name: 'stakeConfig'
        },
        {
          name: 'eventAuthority'
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                  34,
                ]
              },
            ]
          }
        },
        {
          name: 'program'
        },
      ]
      args: []
    },
    {
      name: 'mergeStake'
      discriminator: [14, 3, 146, 23, 163, 105, 246, 99]
      accounts: [
        {
          name: 'config'
          docs: ['the config account under which the bond was created']
        },
        {
          name: 'sourceStake'
          writable: true
        },
        {
          name: 'destinationStake'
          writable: true
        },
        {
          name: 'stakerAuthority'
          docs: [
            'bonds program authority PDA address: settlement staker or bonds withdrawer',
          ]
        },
        {
          name: 'stakeHistory'
        },
        {
          name: 'clock'
        },
        {
          name: 'stakeProgram'
        },
        {
          name: 'eventAuthority'
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                  34,
                ]
              },
            ]
          }
        },
        {
          name: 'program'
        },
      ]
      args: [
        {
          name: 'mergeArgs'
          type: {
            defined: {
              name: 'mergeStakeArgs'
            }
          }
        },
      ]
    },
    {
      name: 'resetStake'
      discriminator: [183, 37, 69, 159, 163, 139, 212, 235]
      accounts: [
        {
          name: 'config'
          docs: ['the config account under which the bond was created']
        },
        {
          name: 'bond'
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  98,
                  111,
                  110,
                  100,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'config'
                account: 'config'
              },
              {
                kind: 'account'
                path: 'voteAccount'
              },
            ]
          }
          relations: ['config', 'voteAccount']
        },
        {
          name: 'settlement'
          docs: ['cannot exist; used to derive settlement authority']
        },
        {
          name: 'stakeAccount'
          docs: [
            'stake account belonging under the settlement by staker authority',
          ]
          writable: true
        },
        {
          name: 'bondsWithdrawerAuthority'
          docs: [
            'bonds withdrawer authority',
            'to cancel settlement funding of the stake account changing staker authority to address',
          ]
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  98,
                  111,
                  110,
                  100,
                  115,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'config'
                account: 'config'
              },
            ]
          }
        },
        {
          name: 'voteAccount'
        },
        {
          name: 'stakeHistory'
        },
        {
          name: 'stakeConfig'
        },
        {
          name: 'clock'
        },
        {
          name: 'stakeProgram'
        },
        {
          name: 'eventAuthority'
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                  34,
                ]
              },
            ]
          }
        },
        {
          name: 'program'
        },
      ]
      args: []
    },
    {
      name: 'withdrawStake'
      discriminator: [153, 8, 22, 138, 105, 176, 87, 66]
      accounts: [
        {
          name: 'config'
          docs: ['the config account under which the bond was created']
          relations: ['operatorAuthority']
        },
        {
          name: 'operatorAuthority'
          docs: [
            'operator authority is allowed to reset the non-delegated stake accounts',
          ]
          signer: true
        },
        {
          name: 'settlement'
          docs: ['cannot exist; used to derive settlement authority']
        },
        {
          name: 'stakeAccount'
          docs: [
            'stake account where staker authority is derived from settlement',
          ]
          writable: true
        },
        {
          name: 'bondsWithdrawerAuthority'
          docs: ['bonds authority to withdraw the stake account']
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  98,
                  111,
                  110,
                  100,
                  115,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'config'
                account: 'config'
              },
            ]
          }
        },
        {
          name: 'withdrawTo'
          writable: true
        },
        {
          name: 'stakeHistory'
        },
        {
          name: 'clock'
        },
        {
          name: 'stakeProgram'
        },
        {
          name: 'eventAuthority'
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                  34,
                ]
              },
            ]
          }
        },
        {
          name: 'program'
        },
      ]
      args: []
    },
    {
      name: 'emergencyPause'
      discriminator: [21, 143, 27, 142, 200, 181, 210, 255]
      accounts: [
        {
          name: 'config'
          writable: true
          relations: ['pauseAuthority']
        },
        {
          name: 'pauseAuthority'
          signer: true
        },
        {
          name: 'eventAuthority'
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                  34,
                ]
              },
            ]
          }
        },
        {
          name: 'program'
        },
      ]
      args: []
    },
    {
      name: 'emergencyResume'
      discriminator: [0, 243, 48, 185, 6, 73, 190, 83]
      accounts: [
        {
          name: 'config'
          writable: true
          relations: ['pauseAuthority']
        },
        {
          name: 'pauseAuthority'
          signer: true
        },
        {
          name: 'eventAuthority'
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                  34,
                ]
              },
            ]
          }
        },
        {
          name: 'program'
        },
      ]
      args: []
    },
    {
      name: 'closeSettlementV2'
      discriminator: [125, 212, 89, 37, 31, 244, 191, 179]
      accounts: [
        {
          name: 'config'
        },
        {
          name: 'bond'
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  98,
                  111,
                  110,
                  100,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'config'
                account: 'config'
              },
              {
                kind: 'account'
                path: 'bond.vote_account'
                account: 'bond'
              },
            ]
          }
          relations: ['config']
        },
        {
          name: 'settlement'
          docs: ['settlement to close when expired']
          writable: true
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  115,
                  101,
                  116,
                  116,
                  108,
                  101,
                  109,
                  101,
                  110,
                  116,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'bond'
                account: 'bond'
              },
              {
                kind: 'account'
                path: 'settlement.merkle_root'
                account: 'settlement'
              },
              {
                kind: 'account'
                path: 'settlement.epoch_created_for'
                account: 'settlement'
              },
            ]
          }
          relations: ['bond', 'rentCollector']
        },
        {
          name: 'settlementClaims'
          writable: true
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  99,
                  108,
                  97,
                  105,
                  109,
                  115,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'settlement'
                account: 'settlement'
              },
            ]
          }
          relations: ['settlement']
        },
        {
          name: 'bondsWithdrawerAuthority'
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  98,
                  111,
                  110,
                  100,
                  115,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'config'
                account: 'config'
              },
            ]
          }
        },
        {
          name: 'rentCollector'
          writable: true
        },
        {
          name: 'splitRentCollector'
          writable: true
        },
        {
          name: 'splitRentRefundAccount'
          docs: [
            "The stake account is funded to the settlement and credited to the bond's validator vote account.",
            'The lamports are utilized to pay back the rent exemption of the split_stake_account, which can be created upon funding the settlement.',
          ]
          writable: true
        },
        {
          name: 'clock'
        },
        {
          name: 'stakeProgram'
        },
        {
          name: 'stakeHistory'
        },
        {
          name: 'eventAuthority'
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                  34,
                ]
              },
            ]
          }
        },
        {
          name: 'program'
        },
      ]
      args: []
    },
    {
      name: 'claimSettlementV2'
      discriminator: [188, 53, 132, 151, 88, 50, 52, 238]
      accounts: [
        {
          name: 'config'
          docs: ['the config account under which the settlement was created']
        },
        {
          name: 'bond'
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  98,
                  111,
                  110,
                  100,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'config'
                account: 'config'
              },
              {
                kind: 'account'
                path: 'bond.vote_account'
                account: 'bond'
              },
            ]
          }
          relations: ['config']
        },
        {
          name: 'settlement'
          writable: true
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  115,
                  101,
                  116,
                  116,
                  108,
                  101,
                  109,
                  101,
                  110,
                  116,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'bond'
                account: 'bond'
              },
              {
                kind: 'account'
                path: 'settlement.merkle_root'
                account: 'settlement'
              },
              {
                kind: 'account'
                path: 'settlement.epoch_created_for'
                account: 'settlement'
              },
            ]
          }
          relations: ['bond']
        },
        {
          name: 'settlementClaims'
          docs: ['deduplication, merkle tree record cannot be claimed twice']
          writable: true
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  99,
                  108,
                  97,
                  105,
                  109,
                  115,
                  95,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'settlement'
                account: 'settlement'
              },
            ]
          }
          relations: ['settlement']
        },
        {
          name: 'stakeAccountFrom'
          docs: ['a stake account that will be withdrawn']
          writable: true
        },
        {
          name: 'stakeAccountTo'
          docs: ['a stake account that will receive the funds']
          writable: true
        },
        {
          name: 'bondsWithdrawerAuthority'
          docs: [
            'authority that manages (owns == by being withdrawer authority) all stakes account under the bonds program',
          ]
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  98,
                  111,
                  110,
                  100,
                  115,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                  34,
                ]
              },
              {
                kind: 'account'
                path: 'config'
                account: 'config'
              },
            ]
          }
        },
        {
          name: 'stakeHistory'
        },
        {
          name: 'clock'
        },
        {
          name: 'stakeProgram'
        },
        {
          name: 'eventAuthority'
          pda: {
            seeds: [
              {
                kind: 'const'
                value: [
                  34,
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                  34,
                ]
              },
            ]
          }
        },
        {
          name: 'program'
        },
      ]
      args: [
        {
          name: 'claimSettlementArgs'
          type: {
            defined: {
              name: 'claimSettlementV2Args'
            }
          }
        },
      ]
    },
  ]
  accounts: [
    {
      name: 'settlementClaim'
      discriminator: [216, 103, 231, 246, 171, 99, 124, 133]
    },
    {
      name: 'bond'
      discriminator: [224, 128, 48, 251, 182, 246, 111, 196]
    },
    {
      name: 'config'
      discriminator: [155, 12, 170, 224, 30, 250, 204, 130]
    },
    {
      name: 'settlementClaims'
      discriminator: [32, 130, 62, 175, 231, 54, 170, 114]
    },
    {
      name: 'settlement'
      discriminator: [55, 11, 219, 33, 36, 136, 40, 182]
    },
    {
      name: 'withdrawRequest'
      discriminator: [186, 239, 174, 191, 189, 13, 47, 196]
    },
  ]
  events: [
    {
      name: 'initBondEvent'
      discriminator: [56, 106, 209, 158, 171, 85, 159, 200]
    },
    {
      name: 'configureBondEvent'
      discriminator: [183, 119, 162, 244, 82, 182, 114, 228]
    },
    {
      name: 'configureBondWithMintEvent'
      discriminator: [209, 167, 200, 198, 99, 71, 4, 96]
    },
    {
      name: 'fundBondEvent'
      discriminator: [156, 63, 156, 252, 109, 181, 73, 110]
    },
    {
      name: 'mintBondEvent'
      discriminator: [82, 190, 245, 33, 35, 128, 142, 197]
    },
    {
      name: 'initConfigEvent'
      discriminator: [125, 127, 160, 86, 247, 110, 50, 238]
    },
    {
      name: 'configureConfigEvent'
      discriminator: [121, 240, 38, 122, 0, 102, 203, 122]
    },
    {
      name: 'emergencyPauseEvent'
      discriminator: [159, 241, 192, 232, 29, 208, 51, 21]
    },
    {
      name: 'emergencyResumeEvent'
      discriminator: [19, 211, 43, 129, 45, 168, 226, 200]
    },
    {
      name: 'claimSettlementV2Event'
      discriminator: [114, 201, 131, 134, 182, 165, 237, 47]
    },
    {
      name: 'initSettlementEvent'
      discriminator: [187, 195, 46, 129, 116, 83, 231, 241]
    },
    {
      name: 'closeSettlementEvent'
      discriminator: [226, 173, 111, 111, 105, 218, 118, 103]
    },
    {
      name: 'cancelSettlementEvent'
      discriminator: [80, 190, 161, 61, 97, 7, 242, 92]
    },
    {
      name: 'fundSettlementEvent'
      discriminator: [104, 161, 6, 77, 82, 236, 4, 114]
    },
    {
      name: 'mergeStakeEvent'
      discriminator: [111, 6, 45, 208, 79, 53, 119, 57]
    },
    {
      name: 'resetStakeEvent'
      discriminator: [255, 49, 219, 199, 119, 10, 195, 177]
    },
    {
      name: 'withdrawStakeEvent'
      discriminator: [47, 85, 239, 214, 207, 29, 151, 88]
    },
    {
      name: 'initWithdrawRequestEvent'
      discriminator: [122, 40, 131, 105, 70, 35, 119, 128]
    },
    {
      name: 'cancelWithdrawRequestEvent'
      discriminator: [221, 97, 104, 35, 19, 137, 248, 246]
    },
    {
      name: 'claimWithdrawRequestEvent'
      discriminator: [201, 210, 144, 108, 235, 209, 85, 58]
    },
    {
      name: 'claimSettlementEvent'
      discriminator: [135, 253, 145, 233, 227, 29, 188, 141]
    },
  ]
  errors: [
    {
      code: 6000
      name: 'invalidProgramId'
      msg: 'Program id in context does not match with the validator bonds id'
    },
    {
      code: 6001
      name: 'invalidAdminAuthority'
      msg: 'Operation requires admin authority signature'
    },
    {
      code: 6002
      name: 'invalidWithdrawRequestAuthority'
      msg: 'Invalid authority to operate with the withdraw request of validator bond account'
    },
    {
      code: 6003
      name: 'invalidOperatorAuthority'
      msg: 'Operation requires operator authority signature'
    },
    {
      code: 6004
      name: 'invalidVoteAccountProgramId'
      msg: 'Provided vote account is not owned by the validator vote program'
    },
    {
      code: 6005
      name: 'invalidStakeAccountState'
      msg: 'Fail to deserialize the stake account'
    },
    {
      code: 6006
      name: 'invalidStakeAccountProgramId'
      msg: 'Provided stake account is not owned by the stake account program'
    },
    {
      code: 6007
      name: 'invalidSettlementAddress'
      msg: 'Fail to create account address for Settlement'
    },
    {
      code: 6008
      name: 'invalidSettlementAuthorityAddress'
      msg: 'Fail to create PDA address for Settlement Authority'
    },
    {
      code: 6009
      name: 'invalidBondsWithdrawerAuthorityAddress'
      msg: 'Fail to create PDA address for Bonds Withdrawer Authority'
    },
    {
      code: 6010
      name: 'invalidSettlementClaimAddress'
      msg: 'Fail to create program address for SettlementClaim'
    },
    {
      code: 6011
      name: 'invalidBondAddress'
      msg: 'Fail to create program address for Bond'
    },
    {
      code: 6012
      name: 'wrongStakeAccountWithdrawer'
      msg: 'Wrong withdrawer authority of the stake account'
    },
    {
      code: 6013
      name: 'invalidWithdrawRequestAddress'
      msg: 'Fail to create program address for WithdrawRequest'
    },
    {
      code: 6014
      name: 'hundredthBasisPointsOverflow'
      msg: 'Value of hundredth basis points is too big'
    },
    {
      code: 6015
      name: 'hundredthBasisPointsCalculation'
      msg: 'Hundredth basis points calculation failure'
    },
    {
      code: 6016
      name: 'hundredthBasisPointsParse'
      msg: 'Hundredth basis points failure to parse the value'
    },
    {
      code: 6017
      name: 'failedToDeserializeVoteAccount'
      msg: 'Cannot deserialize validator vote account data'
    },
    {
      code: 6018
      name: 'bondChangeNotPermitted'
      msg: 'Wrong authority for changing the validator bond account'
    },
    {
      code: 6019
      name: 'stakeNotDelegated'
      msg: "Provided stake cannot be used for bonds, it's not delegated"
    },
    {
      code: 6020
      name: 'bondStakeWrongDelegation'
      msg: 'Provided stake is delegated to a wrong validator vote account'
    },
    {
      code: 6021
      name: 'withdrawRequestNotReady'
      msg: 'Withdraw request has not elapsed the epoch lockup period yet'
    },
    {
      code: 6022
      name: 'settlementNotExpired'
      msg: 'Settlement has not expired yet'
    },
    {
      code: 6023
      name: 'settlementExpired'
      msg: 'Settlement has already expired'
    },
    {
      code: 6024
      name: 'uninitializedStake'
      msg: 'Stake is not initialized'
    },
    {
      code: 6025
      name: 'noStakeOrNotFullyActivated'
      msg: 'Stake account is not fully activated'
    },
    {
      code: 6026
      name: 'unexpectedRemainingAccounts'
      msg: 'Instruction context was provided with unexpected set of remaining accounts'
    },
    {
      code: 6027
      name: 'settlementNotClosed'
      msg: 'Settlement has to be closed'
    },
    {
      code: 6028
      name: 'stakeAccountIsFundedToSettlement'
      msg: 'Provided stake account has been already funded to a settlement'
    },
    {
      code: 6029
      name: 'claimSettlementProofFailed'
      msg: 'Settlement claim proof failed'
    },
    {
      code: 6030
      name: 'stakeLockedUp'
      msg: 'Provided stake account is locked-up'
    },
    {
      code: 6031
      name: 'stakeAccountNotBigEnoughToSplit'
      msg: 'Stake account is not big enough to be split'
    },
    {
      code: 6032
      name: 'claimAmountExceedsMaxTotalClaim'
      msg: 'Claiming bigger amount than the max total claim'
    },
    {
      code: 6033
      name: 'claimCountExceedsMaxMerkleNodes'
      msg: 'Claim exceeded number of claimable nodes in the merkle tree'
    },
    {
      code: 6034
      name: 'emptySettlementMerkleTree'
      msg: 'Empty merkle tree, nothing to be claimed'
    },
    {
      code: 6035
      name: 'claimingStakeAccountLamportsInsufficient'
      msg: 'Provided stake account has not enough lamports to cover the claim'
    },
    {
      code: 6036
      name: 'stakeAccountNotFundedToSettlement'
      msg: 'Provided stake account is not funded under the settlement'
    },
    {
      code: 6037
      name: 'voteAccountValidatorIdentityMismatch'
      msg: 'Validator vote account does not match to provided validator identity signature'
    },
    {
      code: 6038
      name: 'voteAccountMismatch'
      msg: 'Bond vote account address does not match with the provided validator vote account'
    },
    {
      code: 6039
      name: 'configAccountMismatch'
      msg: 'Bond config address does not match with the provided config account'
    },
    {
      code: 6040
      name: 'withdrawRequestVoteAccountMismatch'
      msg: 'Withdraw request vote account address does not match with the provided validator vote account'
    },
    {
      code: 6041
      name: 'bondAccountMismatch'
      msg: 'Bond account address does not match with the stored one'
    },
    {
      code: 6042
      name: 'settlementAccountMismatch'
      msg: 'Settlement account address does not match with the stored one'
    },
    {
      code: 6043
      name: 'rentCollectorMismatch'
      msg: 'Rent collector address does not match permitted rent collector'
    },
    {
      code: 6044
      name: 'stakerAuthorityMismatch'
      msg: "Stake account's staker does not match with the provided authority"
    },
    {
      code: 6045
      name: 'nonBondStakeAuthorities'
      msg: 'One or both stake authorities does not belong to bonds program'
    },
    {
      code: 6046
      name: 'settlementAuthorityMismatch'
      msg: 'Stake account staker authority mismatches with the settlement authority'
    },
    {
      code: 6047
      name: 'stakeDelegationMismatch'
      msg: 'Delegation of provided stake account mismatches'
    },
    {
      code: 6048
      name: 'withdrawRequestAmountTooSmall'
      msg: 'Too small non-withdrawn withdraw request amount, cancel and init new one'
    },
    {
      code: 6049
      name: 'withdrawRequestAlreadyFulfilled'
      msg: 'Withdraw request has been already fulfilled'
    },
    {
      code: 6050
      name: 'claimSettlementMerkleTreeNodeMismatch'
      msg: 'Claim settlement merkle tree node mismatch'
    },
    {
      code: 6051
      name: 'wrongStakeAccountStaker'
      msg: 'Wrong staker authority of the stake account'
    },
    {
      code: 6052
      name: 'alreadyPaused'
      msg: 'Requested pause and already Paused'
    },
    {
      code: 6053
      name: 'notPaused'
      msg: 'Requested resume, but not Paused'
    },
    {
      code: 6054
      name: 'programIsPaused'
      msg: 'Emergency Pause is Active'
    },
    {
      code: 6055
      name: 'invalidPauseAuthority'
      msg: 'Invalid pause authority'
    },
    {
      code: 6056
      name: 'mergeMismatchSameSourceDestination'
      msg: 'Source and destination cannot be the same for merge operation'
    },
    {
      code: 6057
      name: 'wrongStakeAccountState'
      msg: 'Wrong state of the stake account'
    },
    {
      code: 6058
      name: 'validatorIdentityBondMintMismatch'
      msg: 'Validator identity mismatch for bond mint'
    },
    {
      code: 6059
      name: 'invalidBondMintSupply'
      msg: 'Bond mint permits only a single token to exist'
    },
    {
      code: 6060
      name: 'operatorAndPauseAuthorityMismatch'
      msg: 'Operation permitted only to operator or pause authority'
    },
    {
      code: 6061
      name: 'settlementNotReadyForClaiming'
      msg: 'Settlement slots to start claiming not expired yet'
    },
    {
      code: 6062
      name: 'invalidVoteAccountType'
      msg: 'Unsupported vote account type to deserialize'
    },
    {
      code: 6063
      name: 'maxStakeWantedTooLow'
      msg: 'Max stake wanted value is lower to minimum configured value'
    },
    {
      code: 6064
      name: 'noStakeOrNotActivatingOrActivated'
      msg: 'Stake account is not activating or activated'
    },
    {
      code: 6065
      name: 'bitmapSizeMismatch'
      msg: 'Data size mismatch for the bitmap'
    },
    {
      code: 6066
      name: 'bitmapIndexOutOfBonds'
      msg: 'Bitmap index out of bounds'
    },
    {
      code: 6067
      name: 'settlementClaimsNotInitialized'
      msg: 'SettlementClaims account not fully initialized, missing data size'
    },
    {
      code: 6068
      name: 'settlementClaimsTooManyRecords'
      msg: 'SettlementClaims records exceed maximum to fit Solana account size'
    },
    {
      code: 6069
      name: 'settlementClaimsAlreadyInitialized'
      msg: 'SettlementClaims already initialized, no need to increase account size'
    },
    {
      code: 6070
      name: 'settlementAlreadyClaimed'
      msg: 'Settlement has been already claimed'
    },
  ]
  types: [
    {
      name: 'pubkeyValueChange'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'old'
            type: 'pubkey'
          },
          {
            name: 'new'
            type: 'pubkey'
          },
        ]
      }
    },
    {
      name: 'u64ValueChange'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'old'
            type: 'u64'
          },
          {
            name: 'new'
            type: 'u64'
          },
        ]
      }
    },
    {
      name: 'delegationInfo'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'voterPubkey'
            docs: ['to whom the stake is delegated']
            type: 'pubkey'
          },
          {
            name: 'stake'
            docs: ['activated stake amount, set at delegate() time']
            type: 'u64'
          },
          {
            name: 'activationEpoch'
            docs: [
              'epoch at which this stake was activated, std::Epoch::MAX if is a bootstrap stake',
            ]
            type: 'u64'
          },
          {
            name: 'deactivationEpoch'
            docs: [
              'epoch the stake was deactivated, std::Epoch::MAX if not deactivated',
            ]
            type: 'u64'
          },
        ]
      }
    },
    {
      name: 'splitStakeData'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'address'
            type: 'pubkey'
          },
          {
            name: 'amount'
            type: 'u64'
          },
        ]
      }
    },
    {
      name: 'configureBondWithMintArgs'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'validatorIdentity'
            docs: ['Validator identity configured within the vote account.']
            type: 'pubkey'
          },
          {
            name: 'bondAuthority'
            docs: ['New bond authority that can manage the bond account.']
            type: {
              option: 'pubkey'
            }
          },
          {
            name: 'cpmpe'
            docs: [
              'New `cpmpe` value (cost per mille per epoch).',
              'It defines the bid for the validator to get delegated up to `max_stake_wanted` lamports.',
            ]
            type: {
              option: 'u64'
            }
          },
          {
            name: 'maxStakeWanted'
            docs: [
              'new max_stake_wanted value that vote account owner declares',
              'as the maximum delegated stake wanted',
            ]
            type: {
              option: 'u64'
            }
          },
        ]
      }
    },
    {
      name: 'configureBondArgs'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'bondAuthority'
            docs: ['New bond authority that can manage the bond account.']
            type: {
              option: 'pubkey'
            }
          },
          {
            name: 'cpmpe'
            docs: [
              'New `cpmpe` value (cost per mille per epoch).',
              'It defines the bid for the validator to get delegated up to `max_stake_wanted` lamports.',
            ]
            type: {
              option: 'u64'
            }
          },
          {
            name: 'maxStakeWanted'
            docs: [
              'New `max_stake_wanted` value that the vote account owner declares',
              'as the maximum delegated stake desired.',
            ]
            type: {
              option: 'u64'
            }
          },
        ]
      }
    },
    {
      name: 'initBondArgs'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'bondAuthority'
            type: 'pubkey'
          },
          {
            name: 'cpmpe'
            type: 'u64'
          },
          {
            name: 'maxStakeWanted'
            type: 'u64'
          },
        ]
      }
    },
    {
      name: 'configureConfigArgs'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'admin'
            type: {
              option: 'pubkey'
            }
          },
          {
            name: 'operator'
            type: {
              option: 'pubkey'
            }
          },
          {
            name: 'pauseAuthority'
            type: {
              option: 'pubkey'
            }
          },
          {
            name: 'epochsToClaimSettlement'
            type: {
              option: 'u64'
            }
          },
          {
            name: 'withdrawLockupEpochs'
            type: {
              option: 'u64'
            }
          },
          {
            name: 'minimumStakeLamports'
            type: {
              option: 'u64'
            }
          },
          {
            name: 'slotsToStartSettlementClaiming'
            type: {
              option: 'u64'
            }
          },
          {
            name: 'minBondMaxStakeWanted'
            type: {
              option: 'u64'
            }
          },
        ]
      }
    },
    {
      name: 'initConfigArgs'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'adminAuthority'
            type: 'pubkey'
          },
          {
            name: 'operatorAuthority'
            type: 'pubkey'
          },
          {
            name: 'epochsToClaimSettlement'
            type: 'u64'
          },
          {
            name: 'withdrawLockupEpochs'
            type: 'u64'
          },
          {
            name: 'slotsToStartSettlementClaiming'
            type: 'u64'
          },
        ]
      }
    },
    {
      name: 'claimSettlementV2Args'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'proof'
            docs: ['proof that the claim is appropriate']
            type: {
              vec: {
                array: ['u8', 32]
              }
            }
          },
          {
            name: 'treeNodeHash'
            type: {
              array: ['u8', 32]
            }
          },
          {
            name: 'stakeAccountStaker'
            docs: [
              'staker authority of the stake_account_to; merkle root verification',
            ]
            type: 'pubkey'
          },
          {
            name: 'stakeAccountWithdrawer'
            docs: [
              'withdrawer authority of the stake_account_to; merkle root verification',
            ]
            type: 'pubkey'
          },
          {
            name: 'claim'
            docs: ['claim amount; merkle root verification']
            type: 'u64'
          },
          {
            name: 'index'
            docs: [
              'index, ordered claim record in the settlement list; merkle root verification',
            ]
            type: 'u64'
          },
        ]
      }
    },
    {
      name: 'initSettlementArgs'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'merkleRoot'
            docs: [
              'merkle root for this settlement, multiple settlements can be created with the same merkle root,',
              'settlements will be distinguished by the vote_account',
            ]
            type: {
              array: ['u8', 32]
            }
          },
          {
            name: 'maxTotalClaim'
            docs: [
              'maximal number of lamports that can be claimed from this settlement',
            ]
            type: 'u64'
          },
          {
            name: 'maxMerkleNodes'
            docs: [
              'maximal number of merkle tree nodes that can be claimed from this settlement',
            ]
            type: 'u64'
          },
          {
            name: 'rentCollector'
            docs: [
              'collects the rent exempt from the settlement account when closed',
            ]
            type: 'pubkey'
          },
          {
            name: 'epoch'
            docs: ['epoch that the settlement is created for']
            type: 'u64'
          },
        ]
      }
    },
    {
      name: 'mergeStakeArgs'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'settlement'
            type: 'pubkey'
          },
        ]
      }
    },
    {
      name: 'initWithdrawRequestArgs'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'amount'
            type: 'u64'
          },
        ]
      }
    },
    {
      name: 'bumps'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'pda'
            type: 'u8'
          },
          {
            name: 'stakerAuthority'
            type: 'u8'
          },
          {
            name: 'settlementClaims'
            type: 'u8'
          },
        ]
      }
    },
    {
      name: 'settlementClaim'
      docs: [
        'The settlement claim serves for deduplication purposes,',
        'preventing the same settlement from being claimed multiple times with the same claiming data',
      ]
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'settlement'
            docs: ['settlement account this claim belongs under']
            type: 'pubkey'
          },
          {
            name: 'stakeAccountTo'
            docs: ['stake account to which the claim has been withdrawn to']
            type: 'pubkey'
          },
          {
            name: 'stakeAccountStaker'
            docs: [
              'staker authority as part of the merkle proof for this claim',
            ]
            type: 'pubkey'
          },
          {
            name: 'stakeAccountWithdrawer'
            docs: [
              'withdrawer authority as part of the merkle proof for this claim',
            ]
            type: 'pubkey'
          },
          {
            name: 'amount'
            docs: ['claim amount']
            type: 'u64'
          },
          {
            name: 'bump'
            docs: ['PDA account bump, one claim per settlement']
            type: 'u8'
          },
          {
            name: 'rentCollector'
            docs: [
              'rent collector account to get the rent back for claim account creation',
            ]
            type: 'pubkey'
          },
          {
            name: 'reserved'
            docs: ['reserve space for future extensions']
            type: {
              array: ['u8', 93]
            }
          },
        ]
      }
    },
    {
      name: 'bond'
      docs: ['Bond account for a validator vote address']
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'config'
            docs: [
              'Program root config address. Validator bond is created for this config as PDA',
            ]
            type: 'pubkey'
          },
          {
            name: 'voteAccount'
            docs: [
              'Validator vote address that this bond account is crated for',
              'INVARIANTS:',
              '- one bond account per validator vote address',
              '- this program does NOT change stake account delegation voter_pubkey to any other validator vote account',
            ]
            type: 'pubkey'
          },
          {
            name: 'authority'
            docs: [
              'Authority that may close the bond or withdraw stake accounts associated with the bond',
              'The same powers has got the owner of the validator vote account',
            ]
            type: 'pubkey'
          },
          {
            name: 'cpmpe'
            docs: [
              'Cost per mille per epoch.',
              'This field represents the bid the bond (vote) account owner is willing to pay',
              'for up to the `max_stake_wanted` being delegated.',
              'The bid is in cost per mille per epoch similar to Google ads cpm system.',
              '---',
              'The actual amount of lamports deducted from the bond account for the processed bid',
              'is based on the actual delegated lamports during the epoch.',
            ]
            type: 'u64'
          },
          {
            name: 'bump'
            docs: ['PDA Bond address bump seed']
            type: 'u8'
          },
          {
            name: 'maxStakeWanted'
            docs: [
              'Maximum stake (in lamports) that the bond (vote) account owner requests.',
              'This is the maximum stake that will be distributed to the vote account',
              'when all other constraints are fulfilled (managed off-chain).',
              'The vote account owner then goes to auction to obtain up to that maximum.',
              'Use the `cpmpe` field to define the bid for this purpose.',
            ]
            type: 'u64'
          },
          {
            name: 'reserved'
            docs: ['reserve space for future extensions']
            type: {
              array: ['u8', 134]
            }
          },
        ]
      }
    },
    {
      name: 'config'
      docs: ['Root account that configures the validator bonds program']
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'adminAuthority'
            docs: ['Admin authority that can update the config']
            type: 'pubkey'
          },
          {
            name: 'operatorAuthority'
            docs: ['Operator authority (bot hot wallet)']
            type: 'pubkey'
          },
          {
            name: 'epochsToClaimSettlement'
            docs: ['How many epochs permitting to claim the settlement']
            type: 'u64'
          },
          {
            name: 'withdrawLockupEpochs'
            docs: ['How many epochs before withdraw is allowed']
            type: 'u64'
          },
          {
            name: 'minimumStakeLamports'
            docs: [
              'Minimum amount of lamports to be considered for a stake account operations (e.g., split)',
            ]
            type: 'u64'
          },
          {
            name: 'bondsWithdrawerAuthorityBump'
            docs: ['PDA bonds stake accounts authority bump seed']
            type: 'u8'
          },
          {
            name: 'pauseAuthority'
            docs: ['Authority that can pause the program in case of emergency']
            type: 'pubkey'
          },
          {
            name: 'paused'
            type: 'bool'
          },
          {
            name: 'slotsToStartSettlementClaiming'
            docs: [
              'How many slots to wait before settlement is permitted to be claimed',
            ]
            type: 'u64'
          },
          {
            name: 'minBondMaxStakeWanted'
            docs: [
              'Minimum value of max_stake_wanted to be configured by vote account owners at bond.',
            ]
            type: 'u64'
          },
          {
            name: 'reserved'
            docs: ['reserved space for future changes']
            type: {
              array: ['u8', 463]
            }
          },
        ]
      }
    },
    {
      name: 'settlementClaims'
      docs: [
        'Account serving to deduplicate claiming, consists of anchor data as metaata header and bitmap in the remaining space.',
      ]
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'settlement'
            type: 'pubkey'
          },
          {
            name: 'version'
            type: 'u8'
          },
          {
            name: 'maxRecords'
            type: 'u64'
          },
        ]
      }
    },
    {
      name: 'settlement'
      docs: [
        'Settlement account for a particular config and merkle root',
        'Settlement defines that a protected event happened and it will be settled',
      ]
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'bond'
            docs: [
              'the settlement belongs under this bond, i.e., under a particular validator vote account',
            ]
            type: 'pubkey'
          },
          {
            name: 'stakerAuthority'
            docs: [
              "settlement authority used as the 'staker' stake account authority",
              'of stake accounts funded to this settlement',
            ]
            type: 'pubkey'
          },
          {
            name: 'merkleRoot'
            docs: ['256-bit merkle root to check the claims against']
            type: {
              array: ['u8', 32]
            }
          },
          {
            name: 'maxTotalClaim'
            docs: ['maximum number of funds that can ever be claimed']
            type: 'u64'
          },
          {
            name: 'maxMerkleNodes'
            docs: [
              'maximum number of merkle tree nodes that can ever be claimed',
            ]
            type: 'u64'
          },
          {
            name: 'lamportsFunded'
            docs: ['total lamports funded']
            type: 'u64'
          },
          {
            name: 'lamportsClaimed'
            docs: ['total lamports that have been claimed']
            type: 'u64'
          },
          {
            name: 'merkleNodesClaimed'
            docs: ['number of nodes that have been claimed']
            type: 'u64'
          },
          {
            name: 'epochCreatedFor'
            docs: ['what epoch the Settlement has been created for']
            type: 'u64'
          },
          {
            name: 'slotCreatedAt'
            docs: ['when the Settlement was created']
            type: 'u64'
          },
          {
            name: 'rentCollector'
            docs: [
              'address that collects the rent exempt from the Settlement account when closed',
            ]
            type: 'pubkey'
          },
          {
            name: 'splitRentCollector'
            docs: [
              'address that collects rent exempt for "split stake account" possibly created on funding settlement',
            ]
            type: {
              option: 'pubkey'
            }
          },
          {
            name: 'splitRentAmount'
            docs: [
              'amount of lamports that are collected for rent exempt for "split stake account"',
            ]
            type: 'u64'
          },
          {
            name: 'bumps'
            docs: ['PDA bumps']
            type: {
              defined: {
                name: 'bumps'
              }
            }
          },
          {
            name: 'reserved'
            docs: ['reserve space for future extensions']
            type: {
              array: ['u8', 90]
            }
          },
        ]
      }
    },
    {
      name: 'withdrawRequest'
      docs: ['Request from a validator to withdraw the bond']
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'voteAccount'
            docs: ['Validator vote account that requested the withdrawal']
            type: 'pubkey'
          },
          {
            name: 'bond'
            docs: [
              'Bond account that the withdraw request is for (has to match with vote_account)',
            ]
            type: 'pubkey'
          },
          {
            name: 'epoch'
            docs: [
              'Epoch when the withdrawal was requested, i.e., when this "ticket" is created',
            ]
            type: 'u64'
          },
          {
            name: 'requestedAmount'
            docs: ['Amount of lamports to withdraw']
            type: 'u64'
          },
          {
            name: 'withdrawnAmount'
            docs: ['Amount of lamports withdrawn so far']
            type: 'u64'
          },
          {
            name: 'bump'
            docs: ['PDA account bump']
            type: 'u8'
          },
          {
            name: 'reserved'
            docs: ['reserve space for future extensions']
            type: {
              array: ['u8', 93]
            }
          },
        ]
      }
    },
    {
      name: 'initBondEvent'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'bond'
            type: 'pubkey'
          },
          {
            name: 'config'
            type: 'pubkey'
          },
          {
            name: 'voteAccount'
            type: 'pubkey'
          },
          {
            name: 'validatorIdentity'
            type: 'pubkey'
          },
          {
            name: 'authority'
            type: 'pubkey'
          },
          {
            name: 'cpmpe'
            type: 'u64'
          },
          {
            name: 'maxStakeWanted'
            type: 'u64'
          },
        ]
      }
    },
    {
      name: 'configureBondEvent'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'bondAuthority'
            type: {
              option: {
                defined: {
                  name: 'pubkeyValueChange'
                }
              }
            }
          },
          {
            name: 'cpmpe'
            type: {
              option: {
                defined: {
                  name: 'u64ValueChange'
                }
              }
            }
          },
          {
            name: 'maxStakeWanted'
            type: {
              option: {
                defined: {
                  name: 'u64ValueChange'
                }
              }
            }
          },
        ]
      }
    },
    {
      name: 'configureBondWithMintEvent'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'validatorIdentity'
            type: 'pubkey'
          },
          {
            name: 'bondAuthority'
            type: {
              option: {
                defined: {
                  name: 'pubkeyValueChange'
                }
              }
            }
          },
          {
            name: 'cpmpe'
            type: {
              option: {
                defined: {
                  name: 'u64ValueChange'
                }
              }
            }
          },
          {
            name: 'maxStakeWanted'
            type: {
              option: {
                defined: {
                  name: 'u64ValueChange'
                }
              }
            }
          },
        ]
      }
    },
    {
      name: 'fundBondEvent'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'bond'
            type: 'pubkey'
          },
          {
            name: 'voteAccount'
            type: 'pubkey'
          },
          {
            name: 'stakeAccount'
            type: 'pubkey'
          },
          {
            name: 'stakeAuthoritySigner'
            type: 'pubkey'
          },
          {
            name: 'depositedAmount'
            type: 'u64'
          },
        ]
      }
    },
    {
      name: 'mintBondEvent'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'bond'
            type: 'pubkey'
          },
          {
            name: 'validatorIdentity'
            type: 'pubkey'
          },
          {
            name: 'validatorIdentityTokenAccount'
            type: 'pubkey'
          },
          {
            name: 'tokenMetadata'
            type: 'pubkey'
          },
        ]
      }
    },
    {
      name: 'initConfigEvent'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'config'
            type: 'pubkey'
          },
          {
            name: 'adminAuthority'
            type: 'pubkey'
          },
          {
            name: 'operatorAuthority'
            type: 'pubkey'
          },
          {
            name: 'withdrawLockupEpochs'
            type: 'u64'
          },
          {
            name: 'epochsToClaimSettlement'
            type: 'u64'
          },
          {
            name: 'minimumStakeLamports'
            type: 'u64'
          },
          {
            name: 'bondsWithdrawerAuthority'
            type: 'pubkey'
          },
          {
            name: 'slotsToStartSettlementClaiming'
            type: 'u64'
          },
        ]
      }
    },
    {
      name: 'configureConfigEvent'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'adminAuthority'
            type: {
              option: {
                defined: {
                  name: 'pubkeyValueChange'
                }
              }
            }
          },
          {
            name: 'operatorAuthority'
            type: {
              option: {
                defined: {
                  name: 'pubkeyValueChange'
                }
              }
            }
          },
          {
            name: 'pauseAuthority'
            type: {
              option: {
                defined: {
                  name: 'pubkeyValueChange'
                }
              }
            }
          },
          {
            name: 'epochsToClaimSettlement'
            type: {
              option: {
                defined: {
                  name: 'u64ValueChange'
                }
              }
            }
          },
          {
            name: 'minimumStakeLamports'
            type: {
              option: {
                defined: {
                  name: 'u64ValueChange'
                }
              }
            }
          },
          {
            name: 'withdrawLockupEpochs'
            type: {
              option: {
                defined: {
                  name: 'u64ValueChange'
                }
              }
            }
          },
          {
            name: 'slotsToStartSettlementClaiming'
            type: {
              option: {
                defined: {
                  name: 'u64ValueChange'
                }
              }
            }
          },
          {
            name: 'minBondMaxStakeWanted'
            type: {
              option: {
                defined: {
                  name: 'u64ValueChange'
                }
              }
            }
          },
        ]
      }
    },
    {
      name: 'emergencyPauseEvent'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'config'
            type: 'pubkey'
          },
          {
            name: 'adminAuthority'
            type: 'pubkey'
          },
          {
            name: 'operatorAuthority'
            type: 'pubkey'
          },
          {
            name: 'epochsToClaimSettlement'
            type: 'u64'
          },
          {
            name: 'withdrawLockupEpochs'
            type: 'u64'
          },
          {
            name: 'minimumStakeLamports'
            type: 'u64'
          },
          {
            name: 'pauseAuthority'
            type: 'pubkey'
          },
        ]
      }
    },
    {
      name: 'emergencyResumeEvent'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'config'
            type: 'pubkey'
          },
          {
            name: 'adminAuthority'
            type: 'pubkey'
          },
          {
            name: 'operatorAuthority'
            type: 'pubkey'
          },
          {
            name: 'epochsToClaimSettlement'
            type: 'u64'
          },
          {
            name: 'withdrawLockupEpochs'
            type: 'u64'
          },
          {
            name: 'minimumStakeLamports'
            type: 'u64'
          },
          {
            name: 'pauseAuthority'
            type: 'pubkey'
          },
        ]
      }
    },
    {
      name: 'claimSettlementV2Event'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'settlement'
            type: 'pubkey'
          },
          {
            name: 'settlementLamportsClaimed'
            type: {
              defined: {
                name: 'u64ValueChange'
              }
            }
          },
          {
            name: 'settlementMerkleNodesClaimed'
            type: 'u64'
          },
          {
            name: 'stakeAccountTo'
            type: 'pubkey'
          },
          {
            name: 'stakeAccountWithdrawer'
            type: 'pubkey'
          },
          {
            name: 'stakeAccountStaker'
            type: 'pubkey'
          },
          {
            name: 'amount'
            type: 'u64'
          },
          {
            name: 'index'
            type: 'u64'
          },
        ]
      }
    },
    {
      name: 'initSettlementEvent'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'bond'
            type: 'pubkey'
          },
          {
            name: 'settlement'
            type: 'pubkey'
          },
          {
            name: 'voteAccount'
            type: 'pubkey'
          },
          {
            name: 'stakerAuthority'
            type: 'pubkey'
          },
          {
            name: 'merkleRoot'
            type: {
              array: ['u8', 32]
            }
          },
          {
            name: 'maxTotalClaim'
            type: 'u64'
          },
          {
            name: 'maxMerkleNodes'
            type: 'u64'
          },
          {
            name: 'epochCreatedFor'
            type: 'u64'
          },
          {
            name: 'slotCreatedAt'
            type: 'u64'
          },
          {
            name: 'rentCollector'
            type: 'pubkey'
          },
        ]
      }
    },
    {
      name: 'closeSettlementEvent'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'bond'
            type: 'pubkey'
          },
          {
            name: 'settlement'
            type: 'pubkey'
          },
          {
            name: 'merkleRoot'
            type: {
              array: ['u8', 32]
            }
          },
          {
            name: 'maxTotalClaim'
            type: 'u64'
          },
          {
            name: 'maxMerkleNodes'
            type: 'u64'
          },
          {
            name: 'lamportsFunded'
            type: 'u64'
          },
          {
            name: 'lamportsClaimed'
            type: 'u64'
          },
          {
            name: 'merkleNodesClaimed'
            type: 'u64'
          },
          {
            name: 'splitRentCollector'
            type: {
              option: 'pubkey'
            }
          },
          {
            name: 'splitRentRefund'
            type: {
              option: 'pubkey'
            }
          },
          {
            name: 'rentCollector'
            type: 'pubkey'
          },
          {
            name: 'expirationEpoch'
            type: 'u64'
          },
          {
            name: 'currentEpoch'
            type: 'u64'
          },
        ]
      }
    },
    {
      name: 'cancelSettlementEvent'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'bond'
            type: 'pubkey'
          },
          {
            name: 'settlement'
            type: 'pubkey'
          },
          {
            name: 'merkleRoot'
            type: {
              array: ['u8', 32]
            }
          },
          {
            name: 'maxTotalClaim'
            type: 'u64'
          },
          {
            name: 'maxMerkleNodes'
            type: 'u64'
          },
          {
            name: 'lamportsFunded'
            type: 'u64'
          },
          {
            name: 'lamportsClaimed'
            type: 'u64'
          },
          {
            name: 'merkleNodesClaimed'
            type: 'u64'
          },
          {
            name: 'splitRentCollector'
            type: {
              option: 'pubkey'
            }
          },
          {
            name: 'splitRentRefund'
            type: {
              option: 'pubkey'
            }
          },
          {
            name: 'rentCollector'
            type: 'pubkey'
          },
          {
            name: 'authority'
            type: 'pubkey'
          },
        ]
      }
    },
    {
      name: 'fundSettlementEvent'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'bond'
            type: 'pubkey'
          },
          {
            name: 'settlement'
            type: 'pubkey'
          },
          {
            name: 'fundingAmount'
            type: 'u64'
          },
          {
            name: 'stakeAccount'
            type: 'pubkey'
          },
          {
            name: 'lamportsFunded'
            type: 'u64'
          },
          {
            name: 'lamportsClaimed'
            type: 'u64'
          },
          {
            name: 'merkleNodesClaimed'
            type: 'u64'
          },
          {
            name: 'splitStakeAccount'
            type: {
              option: {
                defined: {
                  name: 'splitStakeData'
                }
              }
            }
          },
          {
            name: 'splitRentCollector'
            type: {
              option: 'pubkey'
            }
          },
          {
            name: 'splitRentAmount'
            type: 'u64'
          },
        ]
      }
    },
    {
      name: 'mergeStakeEvent'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'config'
            type: 'pubkey'
          },
          {
            name: 'stakerAuthority'
            type: 'pubkey'
          },
          {
            name: 'destinationStake'
            type: 'pubkey'
          },
          {
            name: 'destinationDelegation'
            type: {
              option: {
                defined: {
                  name: 'delegationInfo'
                }
              }
            }
          },
          {
            name: 'sourceStake'
            type: 'pubkey'
          },
          {
            name: 'sourceDelegation'
            type: {
              option: {
                defined: {
                  name: 'delegationInfo'
                }
              }
            }
          },
        ]
      }
    },
    {
      name: 'resetStakeEvent'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'config'
            type: 'pubkey'
          },
          {
            name: 'bond'
            type: 'pubkey'
          },
          {
            name: 'settlement'
            type: 'pubkey'
          },
          {
            name: 'stakeAccount'
            type: 'pubkey'
          },
          {
            name: 'voteAccount'
            type: 'pubkey'
          },
          {
            name: 'settlementStakerAuthority'
            type: 'pubkey'
          },
        ]
      }
    },
    {
      name: 'withdrawStakeEvent'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'config'
            type: 'pubkey'
          },
          {
            name: 'operatorAuthority'
            type: 'pubkey'
          },
          {
            name: 'settlement'
            type: 'pubkey'
          },
          {
            name: 'stakeAccount'
            type: 'pubkey'
          },
          {
            name: 'withdrawTo'
            type: 'pubkey'
          },
          {
            name: 'settlementStakerAuthority'
            type: 'pubkey'
          },
          {
            name: 'withdrawnAmount'
            type: 'u64'
          },
        ]
      }
    },
    {
      name: 'initWithdrawRequestEvent'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'withdrawRequest'
            type: 'pubkey'
          },
          {
            name: 'bond'
            type: 'pubkey'
          },
          {
            name: 'voteAccount'
            type: 'pubkey'
          },
          {
            name: 'epoch'
            type: 'u64'
          },
          {
            name: 'requestedAmount'
            type: 'u64'
          },
        ]
      }
    },
    {
      name: 'cancelWithdrawRequestEvent'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'withdrawRequest'
            type: 'pubkey'
          },
          {
            name: 'bond'
            type: 'pubkey'
          },
          {
            name: 'authority'
            type: 'pubkey'
          },
          {
            name: 'requestedAmount'
            type: 'u64'
          },
          {
            name: 'withdrawnAmount'
            type: 'u64'
          },
        ]
      }
    },
    {
      name: 'claimWithdrawRequestEvent'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'withdrawRequest'
            type: 'pubkey'
          },
          {
            name: 'bond'
            type: 'pubkey'
          },
          {
            name: 'voteAccount'
            type: 'pubkey'
          },
          {
            name: 'stakeAccount'
            type: 'pubkey'
          },
          {
            name: 'splitStake'
            type: {
              option: {
                defined: {
                  name: 'splitStakeData'
                }
              }
            }
          },
          {
            name: 'newStakeAccountOwner'
            type: 'pubkey'
          },
          {
            name: 'withdrawingAmount'
            type: 'u64'
          },
          {
            name: 'withdrawnAmount'
            type: {
              defined: {
                name: 'u64ValueChange'
              }
            }
          },
        ]
      }
    },
    {
      name: 'claimSettlementEvent'
      type: {
        kind: 'struct'
        fields: [
          {
            name: 'settlementClaim'
            type: 'pubkey'
          },
          {
            name: 'settlement'
            type: 'pubkey'
          },
          {
            name: 'settlementLamportsClaimed'
            type: {
              defined: {
                name: 'u64ValueChange'
              }
            }
          },
          {
            name: 'settlementMerkleNodesClaimed'
            type: 'u64'
          },
          {
            name: 'stakeAccountTo'
            type: 'pubkey'
          },
          {
            name: 'stakeAccountWithdrawer'
            type: 'pubkey'
          },
          {
            name: 'stakeAccountStaker'
            type: 'pubkey'
          },
          {
            name: 'amount'
            type: 'u64'
          },
          {
            name: 'rentCollector'
            type: 'pubkey'
          },
        ]
      }
    },
  ]
  constants: [
    {
      name: 'programId'
      type: 'string'
      value: '"vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4"'
    },
    {
      name: 'bondSeed'
      type: 'bytes'
      value: '[98, 111, 110, 100, 95, 97, 99, 99, 111, 117, 110, 116]'
    },
    {
      name: 'bondMintSeed'
      type: 'bytes'
      value: '[98, 111, 110, 100, 95, 109, 105, 110, 116]'
    },
    {
      name: 'settlementSeed'
      type: 'bytes'
      value: '[115, 101, 116, 116, 108, 101, 109, 101, 110, 116, 95, 97, 99, 99, 111, 117, 110, 116]'
    },
    {
      name: 'withdrawRequestSeed'
      type: 'bytes'
      value: '[119, 105, 116, 104, 100, 114, 97, 119, 95, 97, 99, 99, 111, 117, 110, 116]'
    },
    {
      name: 'bondsWithdrawerAuthoritySeed'
      type: 'bytes'
      value: '[98, 111, 110, 100, 115, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121]'
    },
    {
      name: 'settlementStakerAuthoritySeed'
      type: 'bytes'
      value: '[115, 101, 116, 116, 108, 101, 109, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121]'
    },
    {
      name: 'settlementClaimsSeed'
      type: 'bytes'
      value: '[99, 108, 97, 105, 109, 115, 95, 97, 99, 99, 111, 117, 110, 116]'
    },
    {
      name: 'settlementClaimsAnchorHeaderSize'
      type: 'u8'
      value: '56'
    },
    {
      name: 'settlementClaimSeed'
      type: 'bytes'
      value: '[99, 108, 97, 105, 109, 95, 97, 99, 99, 111, 117, 110, 116]'
    },
  ]
}
