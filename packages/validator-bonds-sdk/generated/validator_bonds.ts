export type ValidatorBonds = {
  "version": "0.1.0",
  "name": "validator_bonds",
  "constants": [
    {
      "name": "PROGRAM_ID",
      "type": "string",
      "value": "\"vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4\""
    },
    {
      "name": "BOND_SEED",
      "type": "bytes",
      "value": "[98, 111, 110, 100, 95, 97, 99, 99, 111, 117, 110, 116]"
    },
    {
      "name": "SETTLEMENT_SEED",
      "type": "bytes",
      "value": "[115, 101, 116, 116, 108, 101, 109, 101, 110, 116, 95, 97, 99, 99, 111, 117, 110, 116]"
    },
    {
      "name": "WITHDRAW_REQUEST_SEED",
      "type": "bytes",
      "value": "[119, 105, 116, 104, 100, 114, 97, 119, 95, 97, 99, 99, 111, 117, 110, 116]"
    },
    {
      "name": "SETTLEMENT_CLAIM_SEED",
      "type": "bytes",
      "value": "[99, 108, 97, 105, 109, 95, 97, 99, 99, 111, 117, 110, 116]"
    },
    {
      "name": "BONDS_AUTHORITY_SEED",
      "type": "bytes",
      "value": "[98, 111, 110, 100, 115, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121]"
    },
    {
      "name": "SETTLEMENT_AUTHORITY_SEED",
      "type": "bytes",
      "value": "[115, 101, 116, 116, 108, 101, 109, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121]"
    }
  ],
  "instructions": [
    {
      "name": "initConfig",
      "accounts": [
        {
          "name": "config",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "config root account to init"
          ]
        },
        {
          "name": "rentPayer",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "rent exempt payer for the config (root) account"
          ]
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "initConfigArgs",
          "type": {
            "defined": "InitConfigArgs"
          }
        }
      ]
    },
    {
      "name": "configureConfig",
      "accounts": [
        {
          "name": "config",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "config root account that will be configured"
          ],
          "relations": [
            "admin_authority"
          ]
        },
        {
          "name": "adminAuthority",
          "isMut": false,
          "isSigner": true,
          "docs": [
            "only the admin authority can change the config params"
          ]
        }
      ],
      "args": [
        {
          "name": "configureConfigArgs",
          "type": {
            "defined": "ConfigureConfigArgs"
          }
        }
      ]
    },
    {
      "name": "initBond",
      "accounts": [
        {
          "name": "config",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "the config root account under which the bond is created"
          ]
        },
        {
          "name": "validatorVoteAccount",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "validatorIdentity",
          "isMut": false,
          "isSigner": true,
          "docs": [
            "only validator vote account validator identity may create the bond"
          ]
        },
        {
          "name": "bond",
          "isMut": true,
          "isSigner": false,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "bond_account"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Config",
                "path": "config"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "path": "validator_vote_account"
              }
            ]
          }
        },
        {
          "name": "rentPayer",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "rent exempt payer of validator bond account creation"
          ]
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "initBondArgs",
          "type": {
            "defined": "InitBondArgs"
          }
        }
      ]
    },
    {
      "name": "configureBond",
      "accounts": [
        {
          "name": "bond",
          "isMut": true,
          "isSigner": false,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "bond_account"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Bond",
                "path": "bond.config"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "path": "validator_vote_account"
              }
            ]
          },
          "relations": [
            "validator_vote_account"
          ]
        },
        {
          "name": "authority",
          "isMut": false,
          "isSigner": true,
          "docs": [
            "validator vote account validator identity or bond authority may change the account"
          ]
        },
        {
          "name": "validatorVoteAccount",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "configureBondArgs",
          "type": {
            "defined": "ConfigureBondArgs"
          }
        }
      ]
    },
    {
      "name": "fundBond",
      "accounts": [
        {
          "name": "config",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "bond",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "bond account to be deposited to with the provided stake account"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "bond_account"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Config",
                "path": "config"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Bond",
                "path": "bond.validator_vote_account"
              }
            ]
          },
          "relations": [
            "config"
          ]
        },
        {
          "name": "bondsWithdrawerAuthority",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "new owner of the stake account, it's the bonds program PDA"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "bonds_authority"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Config",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "stakeAccount",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "stake account to be deposited"
          ]
        },
        {
          "name": "stakeAuthority",
          "isMut": false,
          "isSigner": true,
          "docs": [
            "authority signature permitting to change the stake_account authorities"
          ]
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "stakeHistory",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "stakeProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "initWithdrawRequest",
      "accounts": [
        {
          "name": "config",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "the config root account under which the bond was created"
          ]
        },
        {
          "name": "bond",
          "isMut": false,
          "isSigner": false,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "bond_account"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Config",
                "path": "config"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "path": "validator_vote_account"
              }
            ]
          },
          "relations": [
            "config",
            "validator_vote_account"
          ]
        },
        {
          "name": "validatorVoteAccount",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "authority",
          "isMut": false,
          "isSigner": true,
          "docs": [
            "validator vote account node identity or bond authority may ask for the withdrawal"
          ]
        },
        {
          "name": "withdrawRequest",
          "isMut": true,
          "isSigner": false,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "withdraw_account"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Bond",
                "path": "bond"
              }
            ]
          }
        },
        {
          "name": "rentPayer",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "rent exempt payer of withdraw request account creation"
          ]
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "createWithdrawRequestArgs",
          "type": {
            "defined": "InitWithdrawRequestArgs"
          }
        }
      ]
    },
    {
      "name": "cancelWithdrawRequest",
      "accounts": [
        {
          "name": "bond",
          "isMut": true,
          "isSigner": false,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "bond_account"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Bond",
                "path": "bond.config"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "path": "validator_vote_account"
              }
            ]
          },
          "relations": [
            "validator_vote_account"
          ]
        },
        {
          "name": "validatorVoteAccount",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "authority",
          "isMut": false,
          "isSigner": true,
          "docs": [
            "validator vote account validator identity or bond authority may ask for cancelling"
          ]
        },
        {
          "name": "withdrawRequest",
          "isMut": true,
          "isSigner": false,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "withdraw_request"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Bond",
                "path": "bond"
              }
            ]
          },
          "relations": [
            "bond"
          ]
        },
        {
          "name": "rentCollector",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "claimWithdrawRequest",
      "accounts": [
        {
          "name": "config",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "the config root configuration account"
          ]
        },
        {
          "name": "bond",
          "isMut": true,
          "isSigner": false,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "bond_account"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Config",
                "path": "config"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "path": "validator_vote_account"
              }
            ]
          },
          "relations": [
            "config",
            "validator_vote_account"
          ]
        },
        {
          "name": "validatorVoteAccount",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "withdrawRequest",
          "isMut": true,
          "isSigner": false,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "withdraw_request"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Bond",
                "path": "bond"
              }
            ]
          },
          "relations": [
            "validator_vote_account",
            "bond"
          ]
        },
        {
          "name": "bondsWithdrawerAuthority",
          "isMut": false,
          "isSigner": false,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "bonds_authority"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Config",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "stakeAccount",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "stake account to be used to withdraw the funds",
            "this stake account has to be delegated to the validator vote account associated to the bond"
          ]
        },
        {
          "name": "withdrawer",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "this is the account that will be the new owner (withdrawer authority) of the stake account",
            "and ultimately it receives the withdrawing funds"
          ]
        },
        {
          "name": "splitStakeAccount",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "this is a whatever address that does not exist",
            "when withdrawing needs to split the provided account this will be used as a new stake account"
          ]
        },
        {
          "name": "splitStakeRentPayer",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "when the split_stake_account is created the rent for creation is taken from here",
            "when the split_stake_account is not created then no rent is payed"
          ]
        },
        {
          "name": "stakeProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "stakeHistory",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "initSettlement",
      "accounts": [
        {
          "name": "config",
          "isMut": false,
          "isSigner": false,
          "relations": [
            "operator_authority"
          ]
        },
        {
          "name": "bond",
          "isMut": false,
          "isSigner": false,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "bond_account"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Config",
                "path": "config"
              },
              {
                "kind": "arg",
                "type": {
                  "defined": "InitSettlementArgs"
                },
                "path": "params.vote_account"
              }
            ]
          },
          "relations": [
            "config"
          ]
        },
        {
          "name": "settlement",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "operatorAuthority",
          "isMut": false,
          "isSigner": true,
          "docs": [
            "operator signer authority that is allowed to create the settlement account"
          ]
        },
        {
          "name": "rentPayer",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "rent exempt payer of account creation"
          ]
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "initSettlementArgs",
          "type": {
            "defined": "InitSettlementArgs"
          }
        }
      ]
    },
    {
      "name": "closeSettlement",
      "accounts": [
        {
          "name": "config",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "bond",
          "isMut": false,
          "isSigner": false,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "bond_account"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Config",
                "path": "config"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Bond",
                "path": "bond.validator_vote_account"
              }
            ]
          },
          "relations": [
            "config"
          ]
        },
        {
          "name": "settlement",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "settlement to close when expired"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "settlement_account"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Bond",
                "path": "bond"
              },
              {
                "kind": "account",
                "type": {
                  "array": [
                    "u8",
                    32
                  ]
                },
                "account": "Settlement",
                "path": "settlement.merkle_root"
              },
              {
                "kind": "account",
                "type": "u64",
                "account": "Settlement",
                "path": "settlement.epoch_created_at"
              }
            ]
          },
          "relations": [
            "bond",
            "rent_collector"
          ]
        },
        {
          "name": "rentCollector",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "splitRentCollector",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "bondsWithdrawerAuthority",
          "isMut": false,
          "isSigner": false,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "bonds_authority"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Config",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "stakeAccount",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "a stake account to be used to return back the split rent exempt fee"
          ]
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "stakeProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "stakeHistory",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "fundSettlement",
      "accounts": [
        {
          "name": "config",
          "isMut": false,
          "isSigner": false,
          "relations": [
            "operator_authority"
          ]
        },
        {
          "name": "bond",
          "isMut": false,
          "isSigner": false,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "bond_account"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Config",
                "path": "config"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Bond",
                "path": "bond.validator_vote_account"
              }
            ]
          },
          "relations": [
            "config"
          ]
        },
        {
          "name": "settlement",
          "isMut": true,
          "isSigner": false,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "settlement_account"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Bond",
                "path": "bond"
              },
              {
                "kind": "account",
                "type": {
                  "array": [
                    "u8",
                    32
                  ]
                },
                "account": "Settlement",
                "path": "settlement.merkle_root"
              },
              {
                "kind": "account",
                "type": "u64",
                "account": "Settlement",
                "path": "settlement.epoch_created_at"
              }
            ]
          },
          "relations": [
            "bond",
            "settlement_authority"
          ]
        },
        {
          "name": "operatorAuthority",
          "isMut": false,
          "isSigner": true,
          "docs": [
            "operator signer authority is allowed to fund the settlement account",
            "(making this operation permission-ed, at least for the first version of the contract)"
          ]
        },
        {
          "name": "stakeAccount",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "stake account to be funded into the settlement"
          ]
        },
        {
          "name": "settlementAuthority",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "settlement stake authority to differentiate deposited and funded stake accounts",
            "deposited has got bonds_withdrawer_authority, whilst funded has got the settlement authority"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "settlement_authority"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Settlement",
                "path": "settlement"
              }
            ]
          }
        },
        {
          "name": "bondsWithdrawerAuthority",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "authority that manages (owns) all stakes account under the bonds program"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "bonds_authority"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Config",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "splitStakeAccount",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "a split stake account is needed when the provided stake_account is bigger than the settlement"
          ]
        },
        {
          "name": "splitStakeRentPayer",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "This is an account used to prefund the split stake account.",
            "If a split stake account is not needed then rent payer is fully refunded at the end of the transaction.",
            "If a split stake account is created for the settlement, the payer needs to manually close the claim_settlement",
            "instruction to get the rent back (success only when the stake account is already deactivated)."
          ]
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "stakeHistory",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "rent",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "stakeProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "closeSettlementClaim",
      "accounts": [
        {
          "name": "settlement",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "settlementClaim",
          "isMut": true,
          "isSigner": false,
          "relations": [
            "rent_collector",
            "settlement"
          ]
        },
        {
          "name": "rentCollector",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "claimSettlement",
      "accounts": [
        {
          "name": "config",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "the config root account under which the settlement was created"
          ]
        },
        {
          "name": "bond",
          "isMut": false,
          "isSigner": false,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "bond_account"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Config",
                "path": "config"
              },
              {
                "kind": "arg",
                "type": {
                  "defined": "ClaimSettlementArgs"
                },
                "path": "params.vote_account"
              }
            ]
          },
          "relations": [
            "config"
          ]
        },
        {
          "name": "settlement",
          "isMut": true,
          "isSigner": false,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "settlement_account"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Bond",
                "path": "bond"
              },
              {
                "kind": "account",
                "type": {
                  "array": [
                    "u8",
                    32
                  ]
                },
                "account": "Settlement",
                "path": "settlement.merkle_root"
              },
              {
                "kind": "account",
                "type": "u64",
                "account": "Settlement",
                "path": "settlement.epoch_created_at"
              }
            ]
          },
          "relations": [
            "bond"
          ]
        },
        {
          "name": "settlementClaim",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "deduplication, one amount cannot be claimed twice"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "claim_account"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Settlement",
                "path": "settlement"
              },
              {
                "kind": "arg",
                "type": {
                  "defined": "ClaimSettlementArgs"
                },
                "path": "params.staker"
              },
              {
                "kind": "arg",
                "type": {
                  "defined": "ClaimSettlementArgs"
                },
                "path": "params.withdrawer"
              },
              {
                "kind": "arg",
                "type": {
                  "defined": "ClaimSettlementArgs"
                },
                "path": "params.vote_account"
              },
              {
                "kind": "arg",
                "type": {
                  "defined": "ClaimSettlementArgs"
                },
                "path": "params.claim"
              }
            ]
          }
        },
        {
          "name": "stakeAccount",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "a stake account which will be withdrawn"
          ]
        },
        {
          "name": "withdrawerAuthority",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "account that will receive the funds on this claim"
          ]
        },
        {
          "name": "bondsWithdrawerAuthority",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "authority that manages (owns == being withdrawer authority) all stakes account under the bonds program"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "bonds_authority"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Config",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "rentPayer",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "On claiming it's created a claim account that confirms the claim has happened",
            "when the settlement withdrawal window expires the claim account is closed and rent gets back"
          ]
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "stakeHistory",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "stakeProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "claimSettlementArgs",
          "type": {
            "defined": "ClaimSettlementArgs"
          }
        }
      ]
    },
    {
      "name": "merge",
      "accounts": [
        {
          "name": "config",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "the config root account under which the bond was created"
          ]
        },
        {
          "name": "sourceStake",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "destinationStake",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "stakerAuthority",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "bonds program authority PDA address: settlement staker or bonds withdrawer"
          ]
        },
        {
          "name": "stakeHistory",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "stakeProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "mergeArgs",
          "type": {
            "defined": "MergeArgs"
          }
        }
      ]
    },
    {
      "name": "reset",
      "accounts": [
        {
          "name": "config",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "the config root account under which the bond was created"
          ]
        },
        {
          "name": "bond",
          "isMut": false,
          "isSigner": false,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "bond_account"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Config",
                "path": "config"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Bond",
                "path": "bond.validator_vote_account"
              }
            ]
          },
          "relations": [
            "config"
          ]
        },
        {
          "name": "settlement",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "stakeAccount",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "stake account belonging to authority of the settlement"
          ]
        },
        {
          "name": "settlementAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "bondsWithdrawerAuthority",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "authority that owns (withdrawer authority) all stakes account under the bonds program"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "bonds_authority"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Config",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "validatorVoteAccount",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "stakeHistory",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "stakeConfig",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "stakeProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "bond",
      "docs": [
        "Bond account for a validator vote address"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "docs": [
              "Contract root config address. Validator bond is created for this config as PDA",
              "but saving the address here for easier access with getProgramAccounts call"
            ],
            "type": "publicKey"
          },
          {
            "name": "validatorVoteAccount",
            "docs": [
              "Validator vote address that this bond account is crated for",
              "INVARIANTS:",
              "- one bond account per validator vote address",
              "- bond program does not change received stake account delegation voter_pubkey to any other validator vote"
            ],
            "type": "publicKey"
          },
          {
            "name": "authority",
            "docs": [
              "Authority that may close the bond or withdraw stake accounts associated with the bond",
              "The same powers has got the owner of the validator vote account"
            ],
            "type": "publicKey"
          },
          {
            "name": "revenueShare",
            "docs": [
              "Revenue that is distributed from the bond (from validator) to the protocol"
            ],
            "type": {
              "defined": "HundredthBasisPoint"
            }
          },
          {
            "name": "bump",
            "docs": [
              "PDA Bond address bump seed"
            ],
            "type": "u8"
          },
          {
            "name": "reserved",
            "docs": [
              "reserve space for future extensions"
            ],
            "type": {
              "defined": "Reserved150"
            }
          }
        ]
      }
    },
    {
      "name": "config",
      "docs": [
        "Root account that configures the validator bonds program"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "adminAuthority",
            "docs": [
              "Admin authority that can update the config"
            ],
            "type": "publicKey"
          },
          {
            "name": "operatorAuthority",
            "docs": [
              "Operator authority (bot hot wallet)"
            ],
            "type": "publicKey"
          },
          {
            "name": "epochsToClaimSettlement",
            "docs": [
              "How many epochs permitting to claim the settlement"
            ],
            "type": "u64"
          },
          {
            "name": "withdrawLockupEpochs",
            "docs": [
              "How many epochs before withdraw is allowed"
            ],
            "type": "u64"
          },
          {
            "name": "minimumStakeLamports",
            "docs": [
              "Minimum amount of lamports to be considered for a stake account operations (e.g., split)"
            ],
            "type": "u64"
          },
          {
            "name": "bondsWithdrawerAuthorityBump",
            "docs": [
              "PDA bonds bonds stake accounts authority bump seed"
            ],
            "type": "u8"
          },
          {
            "name": "reserved",
            "docs": [
              "reserved space for future changes"
            ],
            "type": {
              "array": [
                "u8",
                512
              ]
            }
          }
        ]
      }
    },
    {
      "name": "settlementClaim",
      "docs": [
        "Settlement claim serves for deduplication purposes to not allow",
        "claiming the same settlement with the same claiming data twice."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "settlement",
            "docs": [
              "settlement account this claim belongs under"
            ],
            "type": "publicKey"
          },
          {
            "name": "stakerAuthority",
            "docs": [
              "staker authority as part of the merkle proof for this claim"
            ],
            "type": "publicKey"
          },
          {
            "name": "withdrawerAuthority",
            "docs": [
              "withdrawer authority that has got permission to withdraw the claim"
            ],
            "type": "publicKey"
          },
          {
            "name": "voteAccount",
            "docs": [
              "vote account as part of the merkle proof for this claim"
            ],
            "type": "publicKey"
          },
          {
            "name": "claim",
            "docs": [
              "claim amount"
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "docs": [
              "PDA account bump, one claim per settlement"
            ],
            "type": "u8"
          },
          {
            "name": "rentCollector",
            "docs": [
              "rent collector account to get the rent back for claim account creation"
            ],
            "type": "publicKey"
          },
          {
            "name": "reserved",
            "docs": [
              "reserve space for future extensions"
            ],
            "type": {
              "defined": "Reserved150"
            }
          }
        ]
      }
    },
    {
      "name": "settlement",
      "docs": [
        "Settlement account for a particular config and merkle root",
        "Settlement defines that a protected event happened and it will be settled"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bond",
            "docs": [
              "this settlement belongs under particular bond, i.e., under particular validator vote account"
            ],
            "type": "publicKey"
          },
          {
            "name": "settlementAuthority",
            "docs": [
              "stake account authority that manages the funded stake accounts"
            ],
            "type": "publicKey"
          },
          {
            "name": "merkleRoot",
            "docs": [
              "256-bit merkle root to check the claims against"
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "maxTotalClaim",
            "docs": [
              "maximum number of funds that can ever be claimed from this [Settlement]"
            ],
            "type": "u64"
          },
          {
            "name": "maxNumNodes",
            "docs": [
              "maximum number of nodes that can ever be claimed from this [Settlement]"
            ],
            "type": "u64"
          },
          {
            "name": "totalFunded",
            "docs": [
              "total funds that have been deposited to this [Settlement]"
            ],
            "type": "u64"
          },
          {
            "name": "totalFundsClaimed",
            "docs": [
              "total funds that have been claimed from this [Settlement]"
            ],
            "type": "u64"
          },
          {
            "name": "numNodesClaimed",
            "docs": [
              "number of nodes that have been claimed from this [Settlement]"
            ],
            "type": "u64"
          },
          {
            "name": "epochCreatedAt",
            "docs": [
              "epoch that the [Settlement] has been created at"
            ],
            "type": "u64"
          },
          {
            "name": "rentCollector",
            "docs": [
              "address that collects the rent exempt from the [Settlement] account when closed"
            ],
            "type": "publicKey"
          },
          {
            "name": "splitRentCollector",
            "docs": [
              "address that may claim the rent exempt for creation of \"split stake account\""
            ],
            "type": {
              "option": "publicKey"
            }
          },
          {
            "name": "splitRentAmount",
            "type": "u64"
          },
          {
            "name": "bumps",
            "docs": [
              "PDA bumps"
            ],
            "type": {
              "defined": "Bumps"
            }
          },
          {
            "name": "reserved",
            "docs": [
              "reserve space for future extensions"
            ],
            "type": {
              "defined": "Reserved150"
            }
          }
        ]
      }
    },
    {
      "name": "withdrawRequest",
      "docs": [
        "Request from a validator to withdraw their bond"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "validatorVoteAccount",
            "docs": [
              "Validator that requested the withdraw"
            ],
            "type": "publicKey"
          },
          {
            "name": "bond",
            "docs": [
              "Bond account that the withdraw request is for"
            ],
            "type": "publicKey"
          },
          {
            "name": "epoch",
            "docs": [
              "Epoch when the withdraw was requested, i.e., when this \"ticket\" is created"
            ],
            "type": "u64"
          },
          {
            "name": "requestedAmount",
            "docs": [
              "Amount of lamports to withdraw"
            ],
            "type": "u64"
          },
          {
            "name": "withdrawnAmount",
            "docs": [
              "Amount of lamports withdrawn so far"
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "docs": [
              "PDA account bump"
            ],
            "type": "u8"
          },
          {
            "name": "reserved",
            "docs": [
              "reserve space for future extensions"
            ],
            "type": {
              "defined": "Reserved150"
            }
          }
        ]
      }
    }
  ],
  "types": [
    {
      "name": "PubkeyValueChange",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "old",
            "type": "publicKey"
          },
          {
            "name": "new",
            "type": "publicKey"
          }
        ]
      }
    },
    {
      "name": "U64ValueChange",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "old",
            "type": "u64"
          },
          {
            "name": "new",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "HundrethBasisPointChange",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "old",
            "type": {
              "defined": "HundredthBasisPoint"
            }
          },
          {
            "name": "new",
            "type": {
              "defined": "HundredthBasisPoint"
            }
          }
        ]
      }
    },
    {
      "name": "DelegationInfo",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "voterPubkey",
            "docs": [
              "to whom the stake is delegated"
            ],
            "type": "publicKey"
          },
          {
            "name": "stake",
            "docs": [
              "activated stake amount, set at delegate() time"
            ],
            "type": "u64"
          },
          {
            "name": "activationEpoch",
            "docs": [
              "epoch at which this stake was activated, std::Epoch::MAX if is a bootstrap stake"
            ],
            "type": "u64"
          },
          {
            "name": "deactivationEpoch",
            "docs": [
              "epoch the stake was deactivated, std::Epoch::MAX if not deactivated"
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "SplitStakeData",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "address",
            "type": "publicKey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "ConfigureBondArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bondAuthority",
            "type": {
              "option": "publicKey"
            }
          },
          {
            "name": "revenueShare",
            "type": {
              "option": {
                "defined": "HundredthBasisPoint"
              }
            }
          }
        ]
      }
    },
    {
      "name": "InitBondArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bondAuthority",
            "type": "publicKey"
          },
          {
            "name": "revenueShare",
            "type": {
              "defined": "HundredthBasisPoint"
            }
          }
        ]
      }
    },
    {
      "name": "ConfigureConfigArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": {
              "option": "publicKey"
            }
          },
          {
            "name": "operator",
            "type": {
              "option": "publicKey"
            }
          },
          {
            "name": "epochsToClaimSettlement",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "withdrawLockupEpochs",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "minimumStakeLamports",
            "type": {
              "option": "u64"
            }
          }
        ]
      }
    },
    {
      "name": "InitConfigArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "adminAuthority",
            "type": "publicKey"
          },
          {
            "name": "operatorAuthority",
            "type": "publicKey"
          },
          {
            "name": "epochsToClaimSettlement",
            "type": "u64"
          },
          {
            "name": "withdrawLockupEpochs",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "ClaimSettlementArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "proof",
            "type": {
              "vec": {
                "array": [
                  "u8",
                  32
                ]
              }
            }
          },
          {
            "name": "staker",
            "type": "publicKey"
          },
          {
            "name": "withdrawer",
            "docs": [
              "claim holder, withdrawer_authority"
            ],
            "type": "publicKey"
          },
          {
            "name": "voteAccount",
            "type": "publicKey"
          },
          {
            "name": "claim",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "InitSettlementArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "merkleRoot",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "voteAccount",
            "type": "publicKey"
          },
          {
            "name": "settlementTotalClaim",
            "type": "u64"
          },
          {
            "name": "settlementNumNodes",
            "type": "u64"
          },
          {
            "name": "rentCollector",
            "type": "publicKey"
          }
        ]
      }
    },
    {
      "name": "MergeArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "settlement",
            "type": "publicKey"
          }
        ]
      }
    },
    {
      "name": "InitWithdrawRequestArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "Bumps",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pda",
            "type": "u8"
          },
          {
            "name": "authority",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "Reserved150",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                150
              ]
            }
          }
        ]
      }
    },
    {
      "name": "HundredthBasisPoint",
      "docs": [
        "It's a smaller unit of a basis point (basis point = 1/100%), we calculate 1/10_000% here instead.",
        "The max value is 1_000_000 (100%).",
        "1 HundredthBasisPoint = 0.0001%, 10_000 HundredthBasisPoint = 1%, 1_000_000 HundredthBasisPoint = 100%."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "hundredthBps",
            "type": "u32"
          }
        ]
      }
    }
  ],
  "events": [
    {
      "name": "InitBondEvent",
      "fields": [
        {
          "name": "configAddress",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "validatorVoteAccount",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "validatorIdentity",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "authority",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "revenueShare",
          "type": {
            "defined": "HundredthBasisPoint"
          },
          "index": false
        },
        {
          "name": "bondBump",
          "type": "u8",
          "index": false
        }
      ]
    },
    {
      "name": "ConfigureBondEvent",
      "fields": [
        {
          "name": "bondAuthority",
          "type": {
            "option": {
              "defined": "PubkeyValueChange"
            }
          },
          "index": false
        },
        {
          "name": "revenueShare",
          "type": {
            "option": {
              "defined": "HundrethBasisPointChange"
            }
          },
          "index": false
        }
      ]
    },
    {
      "name": "CloseBondEvent",
      "fields": [
        {
          "name": "configAddress",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "validatorVoteAccount",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "authority",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "revenueShare",
          "type": {
            "defined": "HundredthBasisPoint"
          },
          "index": false
        },
        {
          "name": "bump",
          "type": "u8",
          "index": false
        }
      ]
    },
    {
      "name": "FundBondEvent",
      "fields": [
        {
          "name": "bond",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "validatorVote",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "stakeAccount",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "stakeAuthoritySigner",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "depositedAmount",
          "type": "u64",
          "index": false
        }
      ]
    },
    {
      "name": "InitConfigEvent",
      "fields": [
        {
          "name": "adminAuthority",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "operatorAuthority",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "withdrawLockupEpochs",
          "type": "u64",
          "index": false
        },
        {
          "name": "epochsToClaimSettlement",
          "type": "u64",
          "index": false
        },
        {
          "name": "minimumStakeLamports",
          "type": "u64",
          "index": false
        },
        {
          "name": "bondsWithdrawerAuthority",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "bondsWithdrawerAuthorityBump",
          "type": "u8",
          "index": false
        }
      ]
    },
    {
      "name": "ConfigureConfigEvent",
      "fields": [
        {
          "name": "adminAuthority",
          "type": {
            "option": {
              "defined": "PubkeyValueChange"
            }
          },
          "index": false
        },
        {
          "name": "operatorAuthority",
          "type": {
            "option": {
              "defined": "PubkeyValueChange"
            }
          },
          "index": false
        },
        {
          "name": "epochsToClaimSettlement",
          "type": {
            "option": {
              "defined": "U64ValueChange"
            }
          },
          "index": false
        },
        {
          "name": "minimumStakeLamports",
          "type": {
            "option": {
              "defined": "U64ValueChange"
            }
          },
          "index": false
        },
        {
          "name": "withdrawLockupEpochs",
          "type": {
            "option": {
              "defined": "U64ValueChange"
            }
          },
          "index": false
        }
      ]
    },
    {
      "name": "ClaimSettlementEvent",
      "fields": [
        {
          "name": "settlement",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "settlementClaim",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "stakerAuthority",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "withdrawerAuthority",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "voteAccount",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "claim",
          "type": "u64",
          "index": false
        },
        {
          "name": "rentCollector",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "bump",
          "type": "u8",
          "index": false
        }
      ]
    },
    {
      "name": "CloseSettlementClaimEvent",
      "fields": [
        {
          "name": "settlement",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "rentCollector",
          "type": "publicKey",
          "index": false
        }
      ]
    },
    {
      "name": "InitSettlementEvent",
      "fields": [
        {
          "name": "bond",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "voteAccount",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "settlementAuthority",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "merkleRoot",
          "type": {
            "array": [
              "u8",
              32
            ]
          },
          "index": false
        },
        {
          "name": "maxTotalClaim",
          "type": "u64",
          "index": false
        },
        {
          "name": "maxNumNodes",
          "type": "u64",
          "index": false
        },
        {
          "name": "epoch",
          "type": "u64",
          "index": false
        },
        {
          "name": "rentCollector",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "bumps",
          "type": {
            "defined": "Bumps"
          },
          "index": false
        }
      ]
    },
    {
      "name": "CloseSettlementEvent",
      "fields": [
        {
          "name": "bond",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "settlement",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "merkleRoot",
          "type": {
            "array": [
              "u8",
              32
            ]
          },
          "index": false
        },
        {
          "name": "maxTotalClaim",
          "type": "u64",
          "index": false
        },
        {
          "name": "maxNumNodes",
          "type": "u64",
          "index": false
        },
        {
          "name": "totalFunded",
          "type": "u64",
          "index": false
        },
        {
          "name": "totalFundsClaimed",
          "type": "u64",
          "index": false
        },
        {
          "name": "numNodesClaimed",
          "type": "u64",
          "index": false
        },
        {
          "name": "splitRentCollector",
          "type": {
            "option": "publicKey"
          },
          "index": false
        },
        {
          "name": "rentCollector",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "expirationEpoch",
          "type": "u64",
          "index": false
        },
        {
          "name": "currentEpoch",
          "type": "u64",
          "index": false
        }
      ]
    },
    {
      "name": "FundSettlementEvent",
      "fields": [
        {
          "name": "bond",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "voteAccount",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "settlement",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "totalFunded",
          "type": "u64",
          "index": false
        },
        {
          "name": "totalFundsClaimed",
          "type": "u64",
          "index": false
        },
        {
          "name": "numNodesClaimed",
          "type": "u64",
          "index": false
        },
        {
          "name": "stakeAccount",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "splitStakeAccount",
          "type": {
            "option": {
              "defined": "SplitStakeData"
            }
          },
          "index": false
        },
        {
          "name": "splitRentCollector",
          "type": {
            "option": "publicKey"
          },
          "index": false
        },
        {
          "name": "splitRentAmount",
          "type": "u64",
          "index": false
        },
        {
          "name": "fundingAmount",
          "type": "u64",
          "index": false
        }
      ]
    },
    {
      "name": "MergeEvent",
      "fields": [
        {
          "name": "config",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "stakerAuthority",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "destinationStake",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "destinationDelegation",
          "type": {
            "option": {
              "defined": "DelegationInfo"
            }
          },
          "index": false
        },
        {
          "name": "sourceStake",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "sourceDelegation",
          "type": {
            "option": {
              "defined": "DelegationInfo"
            }
          },
          "index": false
        }
      ]
    },
    {
      "name": "ResetEvent",
      "fields": [
        {
          "name": "config",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "bond",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "settlement",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "stakeAccount",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "validatorVoteAcount",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "settlementAuthority",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "bondsWithdrawerAuthority",
          "type": "publicKey",
          "index": false
        }
      ]
    },
    {
      "name": "CreateWithdrawRequestEvent",
      "fields": [
        {
          "name": "withdrawRequest",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "bond",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "validatorVoteAccount",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "bump",
          "type": "u8",
          "index": false
        },
        {
          "name": "epoch",
          "type": "u64",
          "index": false
        },
        {
          "name": "requestedAmount",
          "type": "u64",
          "index": false
        }
      ]
    },
    {
      "name": "CancelWithdrawRequestEvent",
      "fields": [
        {
          "name": "withdrawRequest",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "bond",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "authority",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "requestedAmount",
          "type": "u64",
          "index": false
        },
        {
          "name": "withdrawnAmount",
          "type": "u64",
          "index": false
        }
      ]
    },
    {
      "name": "ClaimWithdrawRequestEvent",
      "fields": [
        {
          "name": "withdrawRequest",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "bond",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "validatorVoteAccount",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "stakeAccount",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "splitStake",
          "type": {
            "option": {
              "defined": "SplitStakeData"
            }
          },
          "index": false
        },
        {
          "name": "newStakeAccountOwner",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "withdrawingAmount",
          "type": "u64",
          "index": false
        },
        {
          "name": "withdrawnAmount",
          "type": {
            "defined": "U64ValueChange"
          },
          "index": false
        }
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "InvalidProgramId",
      "msg": "Program id in context does not match with the validator bonds id"
    },
    {
      "code": 6001,
      "name": "InvalidAdminAuthority",
      "msg": "Operation requires admin authority signature"
    },
    {
      "code": 6002,
      "name": "InvalidWithdrawRequestAuthority",
      "msg": "Invalid authority to operate with the withdraw request of validator bond account"
    },
    {
      "code": 6003,
      "name": "InvalidOperatorAuthority",
      "msg": "Operation requires operator authority signature"
    },
    {
      "code": 6004,
      "name": "InvalidVoteAccountProgramId",
      "msg": "Provided vote account is not owned by the validator vote program"
    },
    {
      "code": 6005,
      "name": "InvalidSettlementAddress",
      "msg": "Fail to create account address for Settlement"
    },
    {
      "code": 6006,
      "name": "InvalidSettlementAuthorityAddress",
      "msg": "Fail to create PDA address for Settlement Authority"
    },
    {
      "code": 6007,
      "name": "InvalidBondsWithdrawerAuthorityAddress",
      "msg": "Fail to create PDA address for Bonds Withdrawer Authority"
    },
    {
      "code": 6008,
      "name": "InvalidSettlementClaimAddress",
      "msg": "Fail to create program address for SettlementClaim"
    },
    {
      "code": 6009,
      "name": "InvalidBondAddress",
      "msg": "Fail to create program address for Bond"
    },
    {
      "code": 6010,
      "name": "InvalidStakeOwner",
      "msg": "Stake account's withdrawer does not match with the provided owner"
    },
    {
      "code": 6011,
      "name": "InvalidWithdrawRequestAddress",
      "msg": "Fail to create program address for WithdrawRequest"
    },
    {
      "code": 6012,
      "name": "HundredthBasisPointsOverflow",
      "msg": "Value of hundredth basis points is too big"
    },
    {
      "code": 6013,
      "name": "HundredthBasisPointsCalculation",
      "msg": "Hundredth basis points calculation failure"
    },
    {
      "code": 6014,
      "name": "HundredthBasisPointsParse",
      "msg": "Hundredth basis points failure to parse the value"
    },
    {
      "code": 6015,
      "name": "FailedToDeserializeVoteAccount",
      "msg": "Cannot deserialize validator vote account data"
    },
    {
      "code": 6016,
      "name": "BondChangeNotPermitted",
      "msg": "Wrong authority for changing the validator bond account"
    },
    {
      "code": 6017,
      "name": "StakeNotDelegated",
      "msg": "Provided stake cannot be used for bonds, it's not delegated"
    },
    {
      "code": 6018,
      "name": "BondStakeWrongDelegation",
      "msg": "Provided stake is delegated to a wrong validator vote account"
    },
    {
      "code": 6019,
      "name": "WithdrawRequestNotReady",
      "msg": "Withdraw request has not elapsed the epoch lockup period yet"
    },
    {
      "code": 6020,
      "name": "SettlementNotExpired",
      "msg": "Settlement has not expired yet"
    },
    {
      "code": 6021,
      "name": "SettlementExpired",
      "msg": "Settlement has already expired"
    },
    {
      "code": 6022,
      "name": "UninitializedStake",
      "msg": "Stake is not initialized"
    },
    {
      "code": 6023,
      "name": "NoStakeOrNotFullyActivated",
      "msg": "Stake account is not fully activated"
    },
    {
      "code": 6024,
      "name": "UnexpectedRemainingAccounts",
      "msg": "Instruction context was provided with unexpected set of remaining accounts"
    },
    {
      "code": 6025,
      "name": "SettlementNotClosed",
      "msg": "Closing SettlementClaim requires the settlement being closed"
    },
    {
      "code": 6026,
      "name": "StakeAccountAlreadyFunded",
      "msg": "Provided stake account has been already funded to a settlement"
    },
    {
      "code": 6027,
      "name": "ClaimSettlementProofFailed",
      "msg": "Settlement claim proof failed"
    },
    {
      "code": 6028,
      "name": "StakeLockedUp",
      "msg": "Provided stake account is locked-up"
    },
    {
      "code": 6029,
      "name": "StakeAccountNotBigEnoughToSplit",
      "msg": "Stake account is not big enough to split"
    },
    {
      "code": 6030,
      "name": "ClaimAmountExceedsMaxTotalClaim",
      "msg": "Claiming bigger amount than the max total claim"
    },
    {
      "code": 6031,
      "name": "ClaimCountExceedsMaxNumNodes",
      "msg": "Claim exceeded number of claimable nodes in the merkle tree"
    },
    {
      "code": 6032,
      "name": "EmptySettlementMerkleTree",
      "msg": "Empty merkle tree, nothing to be claimed"
    },
    {
      "code": 6033,
      "name": "ClaimingStakeAccountLamportsInsufficient",
      "msg": "Provided stake account has not enough lamports to cover the claim"
    },
    {
      "code": 6034,
      "name": "StakeAccountNotFunded",
      "msg": "Provided stake account is not funded under a settlement"
    },
    {
      "code": 6035,
      "name": "VoteAccountValidatorIdentityMismatch",
      "msg": "Validator vote account does not match to provided validator identity signature"
    },
    {
      "code": 6036,
      "name": "VoteAccountMismatch",
      "msg": "Bond vote account address does not match with the provided validator vote account"
    },
    {
      "code": 6037,
      "name": "ConfigAccountMismatch",
      "msg": "Bond config address does not match with the provided config account"
    },
    {
      "code": 6038,
      "name": "WithdrawRequestVoteAccountMismatch",
      "msg": "Withdraw request vote account address does not match with the provided validator vote account"
    },
    {
      "code": 6039,
      "name": "BondAccountMismatch",
      "msg": "Bond account address does not match with the stored one"
    },
    {
      "code": 6040,
      "name": "SettlementAccountMismatch",
      "msg": "Settlement account address does not match with the stored one"
    },
    {
      "code": 6041,
      "name": "RentCollectorMismatch",
      "msg": "Rent collector address does not match permitted rent collector"
    },
    {
      "code": 6042,
      "name": "StakerAuthorityMismatch",
      "msg": "Stake account's staker does not match with the provided authority"
    },
    {
      "code": 6043,
      "name": "NonBondStakeAuthorities",
      "msg": "One or both stake authorities does not belong to bonds program"
    },
    {
      "code": 6044,
      "name": "SettlementAuthorityMismatch",
      "msg": "Settlement stake account authority does not match with the provided stake account authority"
    },
    {
      "code": 6045,
      "name": "StakeDelegationMismatch",
      "msg": "Delegation of provided stake account mismatches"
    },
    {
      "code": 6046,
      "name": "NotYetImplemented",
      "msg": "Not yet implemented"
    }
  ]
};

export const IDL: ValidatorBonds = {
  "version": "0.1.0",
  "name": "validator_bonds",
  "constants": [
    {
      "name": "PROGRAM_ID",
      "type": "string",
      "value": "\"vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4\""
    },
    {
      "name": "BOND_SEED",
      "type": "bytes",
      "value": "[98, 111, 110, 100, 95, 97, 99, 99, 111, 117, 110, 116]"
    },
    {
      "name": "SETTLEMENT_SEED",
      "type": "bytes",
      "value": "[115, 101, 116, 116, 108, 101, 109, 101, 110, 116, 95, 97, 99, 99, 111, 117, 110, 116]"
    },
    {
      "name": "WITHDRAW_REQUEST_SEED",
      "type": "bytes",
      "value": "[119, 105, 116, 104, 100, 114, 97, 119, 95, 97, 99, 99, 111, 117, 110, 116]"
    },
    {
      "name": "SETTLEMENT_CLAIM_SEED",
      "type": "bytes",
      "value": "[99, 108, 97, 105, 109, 95, 97, 99, 99, 111, 117, 110, 116]"
    },
    {
      "name": "BONDS_AUTHORITY_SEED",
      "type": "bytes",
      "value": "[98, 111, 110, 100, 115, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121]"
    },
    {
      "name": "SETTLEMENT_AUTHORITY_SEED",
      "type": "bytes",
      "value": "[115, 101, 116, 116, 108, 101, 109, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121]"
    }
  ],
  "instructions": [
    {
      "name": "initConfig",
      "accounts": [
        {
          "name": "config",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "config root account to init"
          ]
        },
        {
          "name": "rentPayer",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "rent exempt payer for the config (root) account"
          ]
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "initConfigArgs",
          "type": {
            "defined": "InitConfigArgs"
          }
        }
      ]
    },
    {
      "name": "configureConfig",
      "accounts": [
        {
          "name": "config",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "config root account that will be configured"
          ],
          "relations": [
            "admin_authority"
          ]
        },
        {
          "name": "adminAuthority",
          "isMut": false,
          "isSigner": true,
          "docs": [
            "only the admin authority can change the config params"
          ]
        }
      ],
      "args": [
        {
          "name": "configureConfigArgs",
          "type": {
            "defined": "ConfigureConfigArgs"
          }
        }
      ]
    },
    {
      "name": "initBond",
      "accounts": [
        {
          "name": "config",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "the config root account under which the bond is created"
          ]
        },
        {
          "name": "validatorVoteAccount",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "validatorIdentity",
          "isMut": false,
          "isSigner": true,
          "docs": [
            "only validator vote account validator identity may create the bond"
          ]
        },
        {
          "name": "bond",
          "isMut": true,
          "isSigner": false,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "bond_account"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Config",
                "path": "config"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "path": "validator_vote_account"
              }
            ]
          }
        },
        {
          "name": "rentPayer",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "rent exempt payer of validator bond account creation"
          ]
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "initBondArgs",
          "type": {
            "defined": "InitBondArgs"
          }
        }
      ]
    },
    {
      "name": "configureBond",
      "accounts": [
        {
          "name": "bond",
          "isMut": true,
          "isSigner": false,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "bond_account"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Bond",
                "path": "bond.config"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "path": "validator_vote_account"
              }
            ]
          },
          "relations": [
            "validator_vote_account"
          ]
        },
        {
          "name": "authority",
          "isMut": false,
          "isSigner": true,
          "docs": [
            "validator vote account validator identity or bond authority may change the account"
          ]
        },
        {
          "name": "validatorVoteAccount",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "configureBondArgs",
          "type": {
            "defined": "ConfigureBondArgs"
          }
        }
      ]
    },
    {
      "name": "fundBond",
      "accounts": [
        {
          "name": "config",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "bond",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "bond account to be deposited to with the provided stake account"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "bond_account"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Config",
                "path": "config"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Bond",
                "path": "bond.validator_vote_account"
              }
            ]
          },
          "relations": [
            "config"
          ]
        },
        {
          "name": "bondsWithdrawerAuthority",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "new owner of the stake account, it's the bonds program PDA"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "bonds_authority"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Config",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "stakeAccount",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "stake account to be deposited"
          ]
        },
        {
          "name": "stakeAuthority",
          "isMut": false,
          "isSigner": true,
          "docs": [
            "authority signature permitting to change the stake_account authorities"
          ]
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "stakeHistory",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "stakeProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "initWithdrawRequest",
      "accounts": [
        {
          "name": "config",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "the config root account under which the bond was created"
          ]
        },
        {
          "name": "bond",
          "isMut": false,
          "isSigner": false,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "bond_account"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Config",
                "path": "config"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "path": "validator_vote_account"
              }
            ]
          },
          "relations": [
            "config",
            "validator_vote_account"
          ]
        },
        {
          "name": "validatorVoteAccount",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "authority",
          "isMut": false,
          "isSigner": true,
          "docs": [
            "validator vote account node identity or bond authority may ask for the withdrawal"
          ]
        },
        {
          "name": "withdrawRequest",
          "isMut": true,
          "isSigner": false,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "withdraw_account"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Bond",
                "path": "bond"
              }
            ]
          }
        },
        {
          "name": "rentPayer",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "rent exempt payer of withdraw request account creation"
          ]
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "createWithdrawRequestArgs",
          "type": {
            "defined": "InitWithdrawRequestArgs"
          }
        }
      ]
    },
    {
      "name": "cancelWithdrawRequest",
      "accounts": [
        {
          "name": "bond",
          "isMut": true,
          "isSigner": false,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "bond_account"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Bond",
                "path": "bond.config"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "path": "validator_vote_account"
              }
            ]
          },
          "relations": [
            "validator_vote_account"
          ]
        },
        {
          "name": "validatorVoteAccount",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "authority",
          "isMut": false,
          "isSigner": true,
          "docs": [
            "validator vote account validator identity or bond authority may ask for cancelling"
          ]
        },
        {
          "name": "withdrawRequest",
          "isMut": true,
          "isSigner": false,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "withdraw_request"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Bond",
                "path": "bond"
              }
            ]
          },
          "relations": [
            "bond"
          ]
        },
        {
          "name": "rentCollector",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "claimWithdrawRequest",
      "accounts": [
        {
          "name": "config",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "the config root configuration account"
          ]
        },
        {
          "name": "bond",
          "isMut": true,
          "isSigner": false,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "bond_account"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Config",
                "path": "config"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "path": "validator_vote_account"
              }
            ]
          },
          "relations": [
            "config",
            "validator_vote_account"
          ]
        },
        {
          "name": "validatorVoteAccount",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "withdrawRequest",
          "isMut": true,
          "isSigner": false,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "withdraw_request"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Bond",
                "path": "bond"
              }
            ]
          },
          "relations": [
            "validator_vote_account",
            "bond"
          ]
        },
        {
          "name": "bondsWithdrawerAuthority",
          "isMut": false,
          "isSigner": false,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "bonds_authority"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Config",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "stakeAccount",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "stake account to be used to withdraw the funds",
            "this stake account has to be delegated to the validator vote account associated to the bond"
          ]
        },
        {
          "name": "withdrawer",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "this is the account that will be the new owner (withdrawer authority) of the stake account",
            "and ultimately it receives the withdrawing funds"
          ]
        },
        {
          "name": "splitStakeAccount",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "this is a whatever address that does not exist",
            "when withdrawing needs to split the provided account this will be used as a new stake account"
          ]
        },
        {
          "name": "splitStakeRentPayer",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "when the split_stake_account is created the rent for creation is taken from here",
            "when the split_stake_account is not created then no rent is payed"
          ]
        },
        {
          "name": "stakeProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "stakeHistory",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "initSettlement",
      "accounts": [
        {
          "name": "config",
          "isMut": false,
          "isSigner": false,
          "relations": [
            "operator_authority"
          ]
        },
        {
          "name": "bond",
          "isMut": false,
          "isSigner": false,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "bond_account"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Config",
                "path": "config"
              },
              {
                "kind": "arg",
                "type": {
                  "defined": "InitSettlementArgs"
                },
                "path": "params.vote_account"
              }
            ]
          },
          "relations": [
            "config"
          ]
        },
        {
          "name": "settlement",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "operatorAuthority",
          "isMut": false,
          "isSigner": true,
          "docs": [
            "operator signer authority that is allowed to create the settlement account"
          ]
        },
        {
          "name": "rentPayer",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "rent exempt payer of account creation"
          ]
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "initSettlementArgs",
          "type": {
            "defined": "InitSettlementArgs"
          }
        }
      ]
    },
    {
      "name": "closeSettlement",
      "accounts": [
        {
          "name": "config",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "bond",
          "isMut": false,
          "isSigner": false,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "bond_account"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Config",
                "path": "config"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Bond",
                "path": "bond.validator_vote_account"
              }
            ]
          },
          "relations": [
            "config"
          ]
        },
        {
          "name": "settlement",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "settlement to close when expired"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "settlement_account"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Bond",
                "path": "bond"
              },
              {
                "kind": "account",
                "type": {
                  "array": [
                    "u8",
                    32
                  ]
                },
                "account": "Settlement",
                "path": "settlement.merkle_root"
              },
              {
                "kind": "account",
                "type": "u64",
                "account": "Settlement",
                "path": "settlement.epoch_created_at"
              }
            ]
          },
          "relations": [
            "bond",
            "rent_collector"
          ]
        },
        {
          "name": "rentCollector",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "splitRentCollector",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "bondsWithdrawerAuthority",
          "isMut": false,
          "isSigner": false,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "bonds_authority"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Config",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "stakeAccount",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "a stake account to be used to return back the split rent exempt fee"
          ]
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "stakeProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "stakeHistory",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "fundSettlement",
      "accounts": [
        {
          "name": "config",
          "isMut": false,
          "isSigner": false,
          "relations": [
            "operator_authority"
          ]
        },
        {
          "name": "bond",
          "isMut": false,
          "isSigner": false,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "bond_account"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Config",
                "path": "config"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Bond",
                "path": "bond.validator_vote_account"
              }
            ]
          },
          "relations": [
            "config"
          ]
        },
        {
          "name": "settlement",
          "isMut": true,
          "isSigner": false,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "settlement_account"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Bond",
                "path": "bond"
              },
              {
                "kind": "account",
                "type": {
                  "array": [
                    "u8",
                    32
                  ]
                },
                "account": "Settlement",
                "path": "settlement.merkle_root"
              },
              {
                "kind": "account",
                "type": "u64",
                "account": "Settlement",
                "path": "settlement.epoch_created_at"
              }
            ]
          },
          "relations": [
            "bond",
            "settlement_authority"
          ]
        },
        {
          "name": "operatorAuthority",
          "isMut": false,
          "isSigner": true,
          "docs": [
            "operator signer authority is allowed to fund the settlement account",
            "(making this operation permission-ed, at least for the first version of the contract)"
          ]
        },
        {
          "name": "stakeAccount",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "stake account to be funded into the settlement"
          ]
        },
        {
          "name": "settlementAuthority",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "settlement stake authority to differentiate deposited and funded stake accounts",
            "deposited has got bonds_withdrawer_authority, whilst funded has got the settlement authority"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "settlement_authority"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Settlement",
                "path": "settlement"
              }
            ]
          }
        },
        {
          "name": "bondsWithdrawerAuthority",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "authority that manages (owns) all stakes account under the bonds program"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "bonds_authority"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Config",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "splitStakeAccount",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "a split stake account is needed when the provided stake_account is bigger than the settlement"
          ]
        },
        {
          "name": "splitStakeRentPayer",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "This is an account used to prefund the split stake account.",
            "If a split stake account is not needed then rent payer is fully refunded at the end of the transaction.",
            "If a split stake account is created for the settlement, the payer needs to manually close the claim_settlement",
            "instruction to get the rent back (success only when the stake account is already deactivated)."
          ]
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "stakeHistory",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "rent",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "stakeProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "closeSettlementClaim",
      "accounts": [
        {
          "name": "settlement",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "settlementClaim",
          "isMut": true,
          "isSigner": false,
          "relations": [
            "rent_collector",
            "settlement"
          ]
        },
        {
          "name": "rentCollector",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "claimSettlement",
      "accounts": [
        {
          "name": "config",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "the config root account under which the settlement was created"
          ]
        },
        {
          "name": "bond",
          "isMut": false,
          "isSigner": false,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "bond_account"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Config",
                "path": "config"
              },
              {
                "kind": "arg",
                "type": {
                  "defined": "ClaimSettlementArgs"
                },
                "path": "params.vote_account"
              }
            ]
          },
          "relations": [
            "config"
          ]
        },
        {
          "name": "settlement",
          "isMut": true,
          "isSigner": false,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "settlement_account"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Bond",
                "path": "bond"
              },
              {
                "kind": "account",
                "type": {
                  "array": [
                    "u8",
                    32
                  ]
                },
                "account": "Settlement",
                "path": "settlement.merkle_root"
              },
              {
                "kind": "account",
                "type": "u64",
                "account": "Settlement",
                "path": "settlement.epoch_created_at"
              }
            ]
          },
          "relations": [
            "bond"
          ]
        },
        {
          "name": "settlementClaim",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "deduplication, one amount cannot be claimed twice"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "claim_account"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Settlement",
                "path": "settlement"
              },
              {
                "kind": "arg",
                "type": {
                  "defined": "ClaimSettlementArgs"
                },
                "path": "params.staker"
              },
              {
                "kind": "arg",
                "type": {
                  "defined": "ClaimSettlementArgs"
                },
                "path": "params.withdrawer"
              },
              {
                "kind": "arg",
                "type": {
                  "defined": "ClaimSettlementArgs"
                },
                "path": "params.vote_account"
              },
              {
                "kind": "arg",
                "type": {
                  "defined": "ClaimSettlementArgs"
                },
                "path": "params.claim"
              }
            ]
          }
        },
        {
          "name": "stakeAccount",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "a stake account which will be withdrawn"
          ]
        },
        {
          "name": "withdrawerAuthority",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "account that will receive the funds on this claim"
          ]
        },
        {
          "name": "bondsWithdrawerAuthority",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "authority that manages (owns == being withdrawer authority) all stakes account under the bonds program"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "bonds_authority"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Config",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "rentPayer",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "On claiming it's created a claim account that confirms the claim has happened",
            "when the settlement withdrawal window expires the claim account is closed and rent gets back"
          ]
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "stakeHistory",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "stakeProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "claimSettlementArgs",
          "type": {
            "defined": "ClaimSettlementArgs"
          }
        }
      ]
    },
    {
      "name": "merge",
      "accounts": [
        {
          "name": "config",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "the config root account under which the bond was created"
          ]
        },
        {
          "name": "sourceStake",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "destinationStake",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "stakerAuthority",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "bonds program authority PDA address: settlement staker or bonds withdrawer"
          ]
        },
        {
          "name": "stakeHistory",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "stakeProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "mergeArgs",
          "type": {
            "defined": "MergeArgs"
          }
        }
      ]
    },
    {
      "name": "reset",
      "accounts": [
        {
          "name": "config",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "the config root account under which the bond was created"
          ]
        },
        {
          "name": "bond",
          "isMut": false,
          "isSigner": false,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "bond_account"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Config",
                "path": "config"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Bond",
                "path": "bond.validator_vote_account"
              }
            ]
          },
          "relations": [
            "config"
          ]
        },
        {
          "name": "settlement",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "stakeAccount",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "stake account belonging to authority of the settlement"
          ]
        },
        {
          "name": "settlementAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "bondsWithdrawerAuthority",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "authority that owns (withdrawer authority) all stakes account under the bonds program"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "type": "string",
                "value": "bonds_authority"
              },
              {
                "kind": "account",
                "type": "publicKey",
                "account": "Config",
                "path": "config"
              }
            ]
          }
        },
        {
          "name": "validatorVoteAccount",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "stakeHistory",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "stakeConfig",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "stakeProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "bond",
      "docs": [
        "Bond account for a validator vote address"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "docs": [
              "Contract root config address. Validator bond is created for this config as PDA",
              "but saving the address here for easier access with getProgramAccounts call"
            ],
            "type": "publicKey"
          },
          {
            "name": "validatorVoteAccount",
            "docs": [
              "Validator vote address that this bond account is crated for",
              "INVARIANTS:",
              "- one bond account per validator vote address",
              "- bond program does not change received stake account delegation voter_pubkey to any other validator vote"
            ],
            "type": "publicKey"
          },
          {
            "name": "authority",
            "docs": [
              "Authority that may close the bond or withdraw stake accounts associated with the bond",
              "The same powers has got the owner of the validator vote account"
            ],
            "type": "publicKey"
          },
          {
            "name": "revenueShare",
            "docs": [
              "Revenue that is distributed from the bond (from validator) to the protocol"
            ],
            "type": {
              "defined": "HundredthBasisPoint"
            }
          },
          {
            "name": "bump",
            "docs": [
              "PDA Bond address bump seed"
            ],
            "type": "u8"
          },
          {
            "name": "reserved",
            "docs": [
              "reserve space for future extensions"
            ],
            "type": {
              "defined": "Reserved150"
            }
          }
        ]
      }
    },
    {
      "name": "config",
      "docs": [
        "Root account that configures the validator bonds program"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "adminAuthority",
            "docs": [
              "Admin authority that can update the config"
            ],
            "type": "publicKey"
          },
          {
            "name": "operatorAuthority",
            "docs": [
              "Operator authority (bot hot wallet)"
            ],
            "type": "publicKey"
          },
          {
            "name": "epochsToClaimSettlement",
            "docs": [
              "How many epochs permitting to claim the settlement"
            ],
            "type": "u64"
          },
          {
            "name": "withdrawLockupEpochs",
            "docs": [
              "How many epochs before withdraw is allowed"
            ],
            "type": "u64"
          },
          {
            "name": "minimumStakeLamports",
            "docs": [
              "Minimum amount of lamports to be considered for a stake account operations (e.g., split)"
            ],
            "type": "u64"
          },
          {
            "name": "bondsWithdrawerAuthorityBump",
            "docs": [
              "PDA bonds bonds stake accounts authority bump seed"
            ],
            "type": "u8"
          },
          {
            "name": "reserved",
            "docs": [
              "reserved space for future changes"
            ],
            "type": {
              "array": [
                "u8",
                512
              ]
            }
          }
        ]
      }
    },
    {
      "name": "settlementClaim",
      "docs": [
        "Settlement claim serves for deduplication purposes to not allow",
        "claiming the same settlement with the same claiming data twice."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "settlement",
            "docs": [
              "settlement account this claim belongs under"
            ],
            "type": "publicKey"
          },
          {
            "name": "stakerAuthority",
            "docs": [
              "staker authority as part of the merkle proof for this claim"
            ],
            "type": "publicKey"
          },
          {
            "name": "withdrawerAuthority",
            "docs": [
              "withdrawer authority that has got permission to withdraw the claim"
            ],
            "type": "publicKey"
          },
          {
            "name": "voteAccount",
            "docs": [
              "vote account as part of the merkle proof for this claim"
            ],
            "type": "publicKey"
          },
          {
            "name": "claim",
            "docs": [
              "claim amount"
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "docs": [
              "PDA account bump, one claim per settlement"
            ],
            "type": "u8"
          },
          {
            "name": "rentCollector",
            "docs": [
              "rent collector account to get the rent back for claim account creation"
            ],
            "type": "publicKey"
          },
          {
            "name": "reserved",
            "docs": [
              "reserve space for future extensions"
            ],
            "type": {
              "defined": "Reserved150"
            }
          }
        ]
      }
    },
    {
      "name": "settlement",
      "docs": [
        "Settlement account for a particular config and merkle root",
        "Settlement defines that a protected event happened and it will be settled"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bond",
            "docs": [
              "this settlement belongs under particular bond, i.e., under particular validator vote account"
            ],
            "type": "publicKey"
          },
          {
            "name": "settlementAuthority",
            "docs": [
              "stake account authority that manages the funded stake accounts"
            ],
            "type": "publicKey"
          },
          {
            "name": "merkleRoot",
            "docs": [
              "256-bit merkle root to check the claims against"
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "maxTotalClaim",
            "docs": [
              "maximum number of funds that can ever be claimed from this [Settlement]"
            ],
            "type": "u64"
          },
          {
            "name": "maxNumNodes",
            "docs": [
              "maximum number of nodes that can ever be claimed from this [Settlement]"
            ],
            "type": "u64"
          },
          {
            "name": "totalFunded",
            "docs": [
              "total funds that have been deposited to this [Settlement]"
            ],
            "type": "u64"
          },
          {
            "name": "totalFundsClaimed",
            "docs": [
              "total funds that have been claimed from this [Settlement]"
            ],
            "type": "u64"
          },
          {
            "name": "numNodesClaimed",
            "docs": [
              "number of nodes that have been claimed from this [Settlement]"
            ],
            "type": "u64"
          },
          {
            "name": "epochCreatedAt",
            "docs": [
              "epoch that the [Settlement] has been created at"
            ],
            "type": "u64"
          },
          {
            "name": "rentCollector",
            "docs": [
              "address that collects the rent exempt from the [Settlement] account when closed"
            ],
            "type": "publicKey"
          },
          {
            "name": "splitRentCollector",
            "docs": [
              "address that may claim the rent exempt for creation of \"split stake account\""
            ],
            "type": {
              "option": "publicKey"
            }
          },
          {
            "name": "splitRentAmount",
            "type": "u64"
          },
          {
            "name": "bumps",
            "docs": [
              "PDA bumps"
            ],
            "type": {
              "defined": "Bumps"
            }
          },
          {
            "name": "reserved",
            "docs": [
              "reserve space for future extensions"
            ],
            "type": {
              "defined": "Reserved150"
            }
          }
        ]
      }
    },
    {
      "name": "withdrawRequest",
      "docs": [
        "Request from a validator to withdraw their bond"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "validatorVoteAccount",
            "docs": [
              "Validator that requested the withdraw"
            ],
            "type": "publicKey"
          },
          {
            "name": "bond",
            "docs": [
              "Bond account that the withdraw request is for"
            ],
            "type": "publicKey"
          },
          {
            "name": "epoch",
            "docs": [
              "Epoch when the withdraw was requested, i.e., when this \"ticket\" is created"
            ],
            "type": "u64"
          },
          {
            "name": "requestedAmount",
            "docs": [
              "Amount of lamports to withdraw"
            ],
            "type": "u64"
          },
          {
            "name": "withdrawnAmount",
            "docs": [
              "Amount of lamports withdrawn so far"
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "docs": [
              "PDA account bump"
            ],
            "type": "u8"
          },
          {
            "name": "reserved",
            "docs": [
              "reserve space for future extensions"
            ],
            "type": {
              "defined": "Reserved150"
            }
          }
        ]
      }
    }
  ],
  "types": [
    {
      "name": "PubkeyValueChange",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "old",
            "type": "publicKey"
          },
          {
            "name": "new",
            "type": "publicKey"
          }
        ]
      }
    },
    {
      "name": "U64ValueChange",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "old",
            "type": "u64"
          },
          {
            "name": "new",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "HundrethBasisPointChange",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "old",
            "type": {
              "defined": "HundredthBasisPoint"
            }
          },
          {
            "name": "new",
            "type": {
              "defined": "HundredthBasisPoint"
            }
          }
        ]
      }
    },
    {
      "name": "DelegationInfo",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "voterPubkey",
            "docs": [
              "to whom the stake is delegated"
            ],
            "type": "publicKey"
          },
          {
            "name": "stake",
            "docs": [
              "activated stake amount, set at delegate() time"
            ],
            "type": "u64"
          },
          {
            "name": "activationEpoch",
            "docs": [
              "epoch at which this stake was activated, std::Epoch::MAX if is a bootstrap stake"
            ],
            "type": "u64"
          },
          {
            "name": "deactivationEpoch",
            "docs": [
              "epoch the stake was deactivated, std::Epoch::MAX if not deactivated"
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "SplitStakeData",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "address",
            "type": "publicKey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "ConfigureBondArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bondAuthority",
            "type": {
              "option": "publicKey"
            }
          },
          {
            "name": "revenueShare",
            "type": {
              "option": {
                "defined": "HundredthBasisPoint"
              }
            }
          }
        ]
      }
    },
    {
      "name": "InitBondArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bondAuthority",
            "type": "publicKey"
          },
          {
            "name": "revenueShare",
            "type": {
              "defined": "HundredthBasisPoint"
            }
          }
        ]
      }
    },
    {
      "name": "ConfigureConfigArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": {
              "option": "publicKey"
            }
          },
          {
            "name": "operator",
            "type": {
              "option": "publicKey"
            }
          },
          {
            "name": "epochsToClaimSettlement",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "withdrawLockupEpochs",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "minimumStakeLamports",
            "type": {
              "option": "u64"
            }
          }
        ]
      }
    },
    {
      "name": "InitConfigArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "adminAuthority",
            "type": "publicKey"
          },
          {
            "name": "operatorAuthority",
            "type": "publicKey"
          },
          {
            "name": "epochsToClaimSettlement",
            "type": "u64"
          },
          {
            "name": "withdrawLockupEpochs",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "ClaimSettlementArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "proof",
            "type": {
              "vec": {
                "array": [
                  "u8",
                  32
                ]
              }
            }
          },
          {
            "name": "staker",
            "type": "publicKey"
          },
          {
            "name": "withdrawer",
            "docs": [
              "claim holder, withdrawer_authority"
            ],
            "type": "publicKey"
          },
          {
            "name": "voteAccount",
            "type": "publicKey"
          },
          {
            "name": "claim",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "InitSettlementArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "merkleRoot",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "voteAccount",
            "type": "publicKey"
          },
          {
            "name": "settlementTotalClaim",
            "type": "u64"
          },
          {
            "name": "settlementNumNodes",
            "type": "u64"
          },
          {
            "name": "rentCollector",
            "type": "publicKey"
          }
        ]
      }
    },
    {
      "name": "MergeArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "settlement",
            "type": "publicKey"
          }
        ]
      }
    },
    {
      "name": "InitWithdrawRequestArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "Bumps",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pda",
            "type": "u8"
          },
          {
            "name": "authority",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "Reserved150",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                150
              ]
            }
          }
        ]
      }
    },
    {
      "name": "HundredthBasisPoint",
      "docs": [
        "It's a smaller unit of a basis point (basis point = 1/100%), we calculate 1/10_000% here instead.",
        "The max value is 1_000_000 (100%).",
        "1 HundredthBasisPoint = 0.0001%, 10_000 HundredthBasisPoint = 1%, 1_000_000 HundredthBasisPoint = 100%."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "hundredthBps",
            "type": "u32"
          }
        ]
      }
    }
  ],
  "events": [
    {
      "name": "InitBondEvent",
      "fields": [
        {
          "name": "configAddress",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "validatorVoteAccount",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "validatorIdentity",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "authority",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "revenueShare",
          "type": {
            "defined": "HundredthBasisPoint"
          },
          "index": false
        },
        {
          "name": "bondBump",
          "type": "u8",
          "index": false
        }
      ]
    },
    {
      "name": "ConfigureBondEvent",
      "fields": [
        {
          "name": "bondAuthority",
          "type": {
            "option": {
              "defined": "PubkeyValueChange"
            }
          },
          "index": false
        },
        {
          "name": "revenueShare",
          "type": {
            "option": {
              "defined": "HundrethBasisPointChange"
            }
          },
          "index": false
        }
      ]
    },
    {
      "name": "CloseBondEvent",
      "fields": [
        {
          "name": "configAddress",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "validatorVoteAccount",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "authority",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "revenueShare",
          "type": {
            "defined": "HundredthBasisPoint"
          },
          "index": false
        },
        {
          "name": "bump",
          "type": "u8",
          "index": false
        }
      ]
    },
    {
      "name": "FundBondEvent",
      "fields": [
        {
          "name": "bond",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "validatorVote",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "stakeAccount",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "stakeAuthoritySigner",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "depositedAmount",
          "type": "u64",
          "index": false
        }
      ]
    },
    {
      "name": "InitConfigEvent",
      "fields": [
        {
          "name": "adminAuthority",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "operatorAuthority",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "withdrawLockupEpochs",
          "type": "u64",
          "index": false
        },
        {
          "name": "epochsToClaimSettlement",
          "type": "u64",
          "index": false
        },
        {
          "name": "minimumStakeLamports",
          "type": "u64",
          "index": false
        },
        {
          "name": "bondsWithdrawerAuthority",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "bondsWithdrawerAuthorityBump",
          "type": "u8",
          "index": false
        }
      ]
    },
    {
      "name": "ConfigureConfigEvent",
      "fields": [
        {
          "name": "adminAuthority",
          "type": {
            "option": {
              "defined": "PubkeyValueChange"
            }
          },
          "index": false
        },
        {
          "name": "operatorAuthority",
          "type": {
            "option": {
              "defined": "PubkeyValueChange"
            }
          },
          "index": false
        },
        {
          "name": "epochsToClaimSettlement",
          "type": {
            "option": {
              "defined": "U64ValueChange"
            }
          },
          "index": false
        },
        {
          "name": "minimumStakeLamports",
          "type": {
            "option": {
              "defined": "U64ValueChange"
            }
          },
          "index": false
        },
        {
          "name": "withdrawLockupEpochs",
          "type": {
            "option": {
              "defined": "U64ValueChange"
            }
          },
          "index": false
        }
      ]
    },
    {
      "name": "ClaimSettlementEvent",
      "fields": [
        {
          "name": "settlement",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "settlementClaim",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "stakerAuthority",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "withdrawerAuthority",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "voteAccount",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "claim",
          "type": "u64",
          "index": false
        },
        {
          "name": "rentCollector",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "bump",
          "type": "u8",
          "index": false
        }
      ]
    },
    {
      "name": "CloseSettlementClaimEvent",
      "fields": [
        {
          "name": "settlement",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "rentCollector",
          "type": "publicKey",
          "index": false
        }
      ]
    },
    {
      "name": "InitSettlementEvent",
      "fields": [
        {
          "name": "bond",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "voteAccount",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "settlementAuthority",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "merkleRoot",
          "type": {
            "array": [
              "u8",
              32
            ]
          },
          "index": false
        },
        {
          "name": "maxTotalClaim",
          "type": "u64",
          "index": false
        },
        {
          "name": "maxNumNodes",
          "type": "u64",
          "index": false
        },
        {
          "name": "epoch",
          "type": "u64",
          "index": false
        },
        {
          "name": "rentCollector",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "bumps",
          "type": {
            "defined": "Bumps"
          },
          "index": false
        }
      ]
    },
    {
      "name": "CloseSettlementEvent",
      "fields": [
        {
          "name": "bond",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "settlement",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "merkleRoot",
          "type": {
            "array": [
              "u8",
              32
            ]
          },
          "index": false
        },
        {
          "name": "maxTotalClaim",
          "type": "u64",
          "index": false
        },
        {
          "name": "maxNumNodes",
          "type": "u64",
          "index": false
        },
        {
          "name": "totalFunded",
          "type": "u64",
          "index": false
        },
        {
          "name": "totalFundsClaimed",
          "type": "u64",
          "index": false
        },
        {
          "name": "numNodesClaimed",
          "type": "u64",
          "index": false
        },
        {
          "name": "splitRentCollector",
          "type": {
            "option": "publicKey"
          },
          "index": false
        },
        {
          "name": "rentCollector",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "expirationEpoch",
          "type": "u64",
          "index": false
        },
        {
          "name": "currentEpoch",
          "type": "u64",
          "index": false
        }
      ]
    },
    {
      "name": "FundSettlementEvent",
      "fields": [
        {
          "name": "bond",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "voteAccount",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "settlement",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "totalFunded",
          "type": "u64",
          "index": false
        },
        {
          "name": "totalFundsClaimed",
          "type": "u64",
          "index": false
        },
        {
          "name": "numNodesClaimed",
          "type": "u64",
          "index": false
        },
        {
          "name": "stakeAccount",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "splitStakeAccount",
          "type": {
            "option": {
              "defined": "SplitStakeData"
            }
          },
          "index": false
        },
        {
          "name": "splitRentCollector",
          "type": {
            "option": "publicKey"
          },
          "index": false
        },
        {
          "name": "splitRentAmount",
          "type": "u64",
          "index": false
        },
        {
          "name": "fundingAmount",
          "type": "u64",
          "index": false
        }
      ]
    },
    {
      "name": "MergeEvent",
      "fields": [
        {
          "name": "config",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "stakerAuthority",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "destinationStake",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "destinationDelegation",
          "type": {
            "option": {
              "defined": "DelegationInfo"
            }
          },
          "index": false
        },
        {
          "name": "sourceStake",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "sourceDelegation",
          "type": {
            "option": {
              "defined": "DelegationInfo"
            }
          },
          "index": false
        }
      ]
    },
    {
      "name": "ResetEvent",
      "fields": [
        {
          "name": "config",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "bond",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "settlement",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "stakeAccount",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "validatorVoteAcount",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "settlementAuthority",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "bondsWithdrawerAuthority",
          "type": "publicKey",
          "index": false
        }
      ]
    },
    {
      "name": "CreateWithdrawRequestEvent",
      "fields": [
        {
          "name": "withdrawRequest",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "bond",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "validatorVoteAccount",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "bump",
          "type": "u8",
          "index": false
        },
        {
          "name": "epoch",
          "type": "u64",
          "index": false
        },
        {
          "name": "requestedAmount",
          "type": "u64",
          "index": false
        }
      ]
    },
    {
      "name": "CancelWithdrawRequestEvent",
      "fields": [
        {
          "name": "withdrawRequest",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "bond",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "authority",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "requestedAmount",
          "type": "u64",
          "index": false
        },
        {
          "name": "withdrawnAmount",
          "type": "u64",
          "index": false
        }
      ]
    },
    {
      "name": "ClaimWithdrawRequestEvent",
      "fields": [
        {
          "name": "withdrawRequest",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "bond",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "validatorVoteAccount",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "stakeAccount",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "splitStake",
          "type": {
            "option": {
              "defined": "SplitStakeData"
            }
          },
          "index": false
        },
        {
          "name": "newStakeAccountOwner",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "withdrawingAmount",
          "type": "u64",
          "index": false
        },
        {
          "name": "withdrawnAmount",
          "type": {
            "defined": "U64ValueChange"
          },
          "index": false
        }
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "InvalidProgramId",
      "msg": "Program id in context does not match with the validator bonds id"
    },
    {
      "code": 6001,
      "name": "InvalidAdminAuthority",
      "msg": "Operation requires admin authority signature"
    },
    {
      "code": 6002,
      "name": "InvalidWithdrawRequestAuthority",
      "msg": "Invalid authority to operate with the withdraw request of validator bond account"
    },
    {
      "code": 6003,
      "name": "InvalidOperatorAuthority",
      "msg": "Operation requires operator authority signature"
    },
    {
      "code": 6004,
      "name": "InvalidVoteAccountProgramId",
      "msg": "Provided vote account is not owned by the validator vote program"
    },
    {
      "code": 6005,
      "name": "InvalidSettlementAddress",
      "msg": "Fail to create account address for Settlement"
    },
    {
      "code": 6006,
      "name": "InvalidSettlementAuthorityAddress",
      "msg": "Fail to create PDA address for Settlement Authority"
    },
    {
      "code": 6007,
      "name": "InvalidBondsWithdrawerAuthorityAddress",
      "msg": "Fail to create PDA address for Bonds Withdrawer Authority"
    },
    {
      "code": 6008,
      "name": "InvalidSettlementClaimAddress",
      "msg": "Fail to create program address for SettlementClaim"
    },
    {
      "code": 6009,
      "name": "InvalidBondAddress",
      "msg": "Fail to create program address for Bond"
    },
    {
      "code": 6010,
      "name": "InvalidStakeOwner",
      "msg": "Stake account's withdrawer does not match with the provided owner"
    },
    {
      "code": 6011,
      "name": "InvalidWithdrawRequestAddress",
      "msg": "Fail to create program address for WithdrawRequest"
    },
    {
      "code": 6012,
      "name": "HundredthBasisPointsOverflow",
      "msg": "Value of hundredth basis points is too big"
    },
    {
      "code": 6013,
      "name": "HundredthBasisPointsCalculation",
      "msg": "Hundredth basis points calculation failure"
    },
    {
      "code": 6014,
      "name": "HundredthBasisPointsParse",
      "msg": "Hundredth basis points failure to parse the value"
    },
    {
      "code": 6015,
      "name": "FailedToDeserializeVoteAccount",
      "msg": "Cannot deserialize validator vote account data"
    },
    {
      "code": 6016,
      "name": "BondChangeNotPermitted",
      "msg": "Wrong authority for changing the validator bond account"
    },
    {
      "code": 6017,
      "name": "StakeNotDelegated",
      "msg": "Provided stake cannot be used for bonds, it's not delegated"
    },
    {
      "code": 6018,
      "name": "BondStakeWrongDelegation",
      "msg": "Provided stake is delegated to a wrong validator vote account"
    },
    {
      "code": 6019,
      "name": "WithdrawRequestNotReady",
      "msg": "Withdraw request has not elapsed the epoch lockup period yet"
    },
    {
      "code": 6020,
      "name": "SettlementNotExpired",
      "msg": "Settlement has not expired yet"
    },
    {
      "code": 6021,
      "name": "SettlementExpired",
      "msg": "Settlement has already expired"
    },
    {
      "code": 6022,
      "name": "UninitializedStake",
      "msg": "Stake is not initialized"
    },
    {
      "code": 6023,
      "name": "NoStakeOrNotFullyActivated",
      "msg": "Stake account is not fully activated"
    },
    {
      "code": 6024,
      "name": "UnexpectedRemainingAccounts",
      "msg": "Instruction context was provided with unexpected set of remaining accounts"
    },
    {
      "code": 6025,
      "name": "SettlementNotClosed",
      "msg": "Closing SettlementClaim requires the settlement being closed"
    },
    {
      "code": 6026,
      "name": "StakeAccountAlreadyFunded",
      "msg": "Provided stake account has been already funded to a settlement"
    },
    {
      "code": 6027,
      "name": "ClaimSettlementProofFailed",
      "msg": "Settlement claim proof failed"
    },
    {
      "code": 6028,
      "name": "StakeLockedUp",
      "msg": "Provided stake account is locked-up"
    },
    {
      "code": 6029,
      "name": "StakeAccountNotBigEnoughToSplit",
      "msg": "Stake account is not big enough to split"
    },
    {
      "code": 6030,
      "name": "ClaimAmountExceedsMaxTotalClaim",
      "msg": "Claiming bigger amount than the max total claim"
    },
    {
      "code": 6031,
      "name": "ClaimCountExceedsMaxNumNodes",
      "msg": "Claim exceeded number of claimable nodes in the merkle tree"
    },
    {
      "code": 6032,
      "name": "EmptySettlementMerkleTree",
      "msg": "Empty merkle tree, nothing to be claimed"
    },
    {
      "code": 6033,
      "name": "ClaimingStakeAccountLamportsInsufficient",
      "msg": "Provided stake account has not enough lamports to cover the claim"
    },
    {
      "code": 6034,
      "name": "StakeAccountNotFunded",
      "msg": "Provided stake account is not funded under a settlement"
    },
    {
      "code": 6035,
      "name": "VoteAccountValidatorIdentityMismatch",
      "msg": "Validator vote account does not match to provided validator identity signature"
    },
    {
      "code": 6036,
      "name": "VoteAccountMismatch",
      "msg": "Bond vote account address does not match with the provided validator vote account"
    },
    {
      "code": 6037,
      "name": "ConfigAccountMismatch",
      "msg": "Bond config address does not match with the provided config account"
    },
    {
      "code": 6038,
      "name": "WithdrawRequestVoteAccountMismatch",
      "msg": "Withdraw request vote account address does not match with the provided validator vote account"
    },
    {
      "code": 6039,
      "name": "BondAccountMismatch",
      "msg": "Bond account address does not match with the stored one"
    },
    {
      "code": 6040,
      "name": "SettlementAccountMismatch",
      "msg": "Settlement account address does not match with the stored one"
    },
    {
      "code": 6041,
      "name": "RentCollectorMismatch",
      "msg": "Rent collector address does not match permitted rent collector"
    },
    {
      "code": 6042,
      "name": "StakerAuthorityMismatch",
      "msg": "Stake account's staker does not match with the provided authority"
    },
    {
      "code": 6043,
      "name": "NonBondStakeAuthorities",
      "msg": "One or both stake authorities does not belong to bonds program"
    },
    {
      "code": 6044,
      "name": "SettlementAuthorityMismatch",
      "msg": "Settlement stake account authority does not match with the provided stake account authority"
    },
    {
      "code": 6045,
      "name": "StakeDelegationMismatch",
      "msg": "Delegation of provided stake account mismatches"
    },
    {
      "code": 6046,
      "name": "NotYetImplemented",
      "msg": "Not yet implemented"
    }
  ]
};
