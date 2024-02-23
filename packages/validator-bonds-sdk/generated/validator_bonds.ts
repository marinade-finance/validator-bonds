export type ValidatorBonds = {
  "version": "1.1.0",
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
      "name": "BONDS_WITHDRAWER_AUTHORITY_SEED",
      "type": "bytes",
      "value": "[98, 111, 110, 100, 115, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121]"
    },
    {
      "name": "SETTLEMENT_STAKER_AUTHORITY_SEED",
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
          "name": "voteAccount",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "validatorIdentity",
          "isMut": false,
          "isSigner": true,
          "isOptional": true,
          "docs": [
            "when validator identity signs the instruction then configuration arguments are applied",
            "otherwise it's a permission-less operation that uses default init bond setup"
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
                "path": "vote_account"
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
          "name": "config",
          "isMut": false,
          "isSigner": false
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
                "path": "vote_account"
              }
            ]
          },
          "relations": [
            "vote_account",
            "config"
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
          "name": "voteAccount",
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
                "path": "bond.vote_account"
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
                "path": "vote_account"
              }
            ]
          },
          "relations": [
            "config",
            "vote_account"
          ]
        },
        {
          "name": "voteAccount",
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
          "name": "config",
          "isMut": false,
          "isSigner": false
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
                "path": "vote_account"
              }
            ]
          },
          "relations": [
            "vote_account",
            "config"
          ]
        },
        {
          "name": "voteAccount",
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
                "value": "withdraw_account"
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
                "path": "vote_account"
              }
            ]
          },
          "relations": [
            "config",
            "vote_account"
          ]
        },
        {
          "name": "voteAccount",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "authority",
          "isMut": false,
          "isSigner": true,
          "docs": [
            "validator vote account node identity or bond authority may claim"
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
          },
          "relations": [
            "vote_account",
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
            "New owner of the stake account, it will be accounted to the withdrawer authority"
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
                "kind": "account",
                "type": "publicKey",
                "account": "Bond",
                "path": "bond.vote_account"
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
                "kind": "arg",
                "type": {
                  "defined": "InitSettlementArgs"
                },
                "path": "params.merkle_root"
              },
              {
                "kind": "arg",
                "type": {
                  "defined": "InitSettlementArgs"
                },
                "path": "params.epoch"
              }
            ]
          }
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
                "path": "bond.vote_account"
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
                "path": "settlement.epoch_created_for"
              }
            ]
          },
          "relations": [
            "bond",
            "rent_collector"
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
          "name": "splitRentRefundAccount",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "a stake account that was funded to the settlement credited to bond's validator vote account",
            "lamports of the stake accounts are used to pay back rent exempt of the split_stake_account",
            "that can be created on funding the settlement"
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
                "path": "bond.vote_account"
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
                "path": "settlement.epoch_created_for"
              }
            ]
          },
          "relations": [
            "bond"
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
          "name": "settlementStakerAuthority",
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
            "an account that does not exist, it will be initialized as a stake account (the signature needed)",
            "the split_stake_account is needed when the provided stake_account is consists of more lamports",
            "than the amount needed to fund the settlement, the left-over lamports from the stake account is split",
            "into the new split_stake_account; when the split_stake_account is not needed, the rent payer is refunded"
          ]
        },
        {
          "name": "splitStakeRentPayer",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "rent exempt payer of the split_stake_account creation",
            "if the split_stake_account is not needed (no left-over lamports on funding) then rent payer is refunded",
            "it the split_stake_account is needed to spill out over funding of the settlement",
            "then the rent payer is refunded when the settlement is closed"
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
                "kind": "account",
                "type": "publicKey",
                "account": "Bond",
                "path": "bond.vote_account"
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
                "path": "settlement.epoch_created_for"
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
                "path": "params.tree_node_hash"
              }
            ]
          }
        },
        {
          "name": "stakeAccountFrom",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "a stake account which will be withdrawn"
          ]
        },
        {
          "name": "stakeAccountTo",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "a stake account that will receive the funds"
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
      "name": "mergeStake",
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
            "defined": "MergeStakeArgs"
          }
        }
      ]
    },
    {
      "name": "resetStake",
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
                "path": "vote_account"
              }
            ]
          },
          "relations": [
            "config",
            "vote_account"
          ]
        },
        {
          "name": "settlement",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "settlement account used to derive settlement authority which cannot exists"
          ]
        },
        {
          "name": "stakeAccount",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "stake account belonging under the settlement by staker authority"
          ]
        },
        {
          "name": "bondsWithdrawerAuthority",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "bonds withdrawer authority",
            "to cancel settlement funding of the stake account changing staker authority to address"
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
          "name": "voteAccount",
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
    },
    {
      "name": "withdrawStake",
      "accounts": [
        {
          "name": "config",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "the config root account under which the bond was created"
          ],
          "relations": [
            "operator_authority"
          ]
        },
        {
          "name": "operatorAuthority",
          "isMut": false,
          "isSigner": true,
          "docs": [
            "operator authority is allowed to reset the non-delegated stake accounts"
          ]
        },
        {
          "name": "settlement",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "settlement account used to derive settlement authority which cannot exists"
          ]
        },
        {
          "name": "stakeAccount",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "stake account where staker authority is of the settlement"
          ]
        },
        {
          "name": "bondsWithdrawerAuthority",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "bonds withdrawer authority",
            "to cancel settlement funding of the stake account changing staker authority to address"
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
          "name": "withdrawTo",
          "isMut": true,
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
      "args": []
    },
    {
      "name": "emergencyPause",
      "accounts": [
        {
          "name": "config",
          "isMut": true,
          "isSigner": false,
          "relations": [
            "pause_authority"
          ]
        },
        {
          "name": "pauseAuthority",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": []
    },
    {
      "name": "emergencyResume",
      "accounts": [
        {
          "name": "config",
          "isMut": true,
          "isSigner": false,
          "relations": [
            "pause_authority"
          ]
        },
        {
          "name": "pauseAuthority",
          "isMut": false,
          "isSigner": true
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
            "name": "voteAccount",
            "docs": [
              "Validator vote address that this bond account is crated for",
              "INVARIANTS:",
              "- one bond account per validator vote address",
              "- this program does NOT change stake account delegation voter_pubkey to any other validator vote account"
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
            "name": "cpmpe",
            "docs": [
              "Cost per mille per epoch"
            ],
            "type": "u64"
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
              "array": [
                "u8",
                142
              ]
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
              "PDA bonds stake accounts authority bump seed"
            ],
            "type": "u8"
          },
          {
            "name": "pauseAuthority",
            "docs": [
              "Authority that can pause the program in case of emergency"
            ],
            "type": "publicKey"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "reserved",
            "docs": [
              "reserved space for future changes"
            ],
            "type": {
              "array": [
                "u8",
                479
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
            "name": "stakeAccountTo",
            "docs": [
              "stake account to which the claim has been withdrawn to"
            ],
            "type": "publicKey"
          },
          {
            "name": "stakeAccountStaker",
            "docs": [
              "staker authority as part of the merkle proof for this claim"
            ],
            "type": "publicKey"
          },
          {
            "name": "stakeAccountWithdrawer",
            "docs": [
              "withdrawer authority as part of the merkle proof for this claim"
            ],
            "type": "publicKey"
          },
          {
            "name": "amount",
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
              "array": [
                "u8",
                93
              ]
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
            "name": "stakerAuthority",
            "docs": [
              "settlement authority used as the 'staker' stake account authority",
              "of stake accounts funded to this settlement"
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
            "name": "maxMerkleNodes",
            "docs": [
              "maximum number of merkle tree nodes that can ever be claimed from this [Settlement]"
            ],
            "type": "u64"
          },
          {
            "name": "lamportsFunded",
            "docs": [
              "total lamports funded to this [Settlement]"
            ],
            "type": "u64"
          },
          {
            "name": "lamportsClaimed",
            "docs": [
              "total lamports that have been claimed from this [Settlement]"
            ],
            "type": "u64"
          },
          {
            "name": "merkleNodesClaimed",
            "docs": [
              "number of nodes that have been claimed from this [Settlement]"
            ],
            "type": "u64"
          },
          {
            "name": "epochCreatedFor",
            "docs": [
              "what epoch the [Settlement] has been created for"
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
              "address claiming the rent exempt for \"split stake account\" created on funding settlement"
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
              "array": [
                "u8",
                99
              ]
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
            "name": "voteAccount",
            "docs": [
              "Validator vote account that requested the withdraw"
            ],
            "type": "publicKey"
          },
          {
            "name": "bond",
            "docs": [
              "Bond account that the withdraw request is for (has to match with vote_account)"
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
              "array": [
                "u8",
                93
              ]
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
            "name": "cpmpe",
            "type": {
              "option": "u64"
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
            "name": "cpmpe",
            "type": "u64"
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
            "name": "pauseAuthority",
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
            "name": "proof",
            "docs": [
              "proof that the claim is appropriate"
            ],
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
            "name": "treeNodeHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "stakeAccountStaker",
            "docs": [
              "staker authority of the stake_account_to; merkle root verification"
            ],
            "type": "publicKey"
          },
          {
            "name": "stakeAccountWithdrawer",
            "docs": [
              "withdrawer authority of the stake_account_to; merkle root verification"
            ],
            "type": "publicKey"
          },
          {
            "name": "claim",
            "docs": [
              "claim amount; merkle root verification"
            ],
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
            "docs": [
              "merkle root for this settlement, multiple settlements can be created with the same merkle root,",
              "settlements will be distinguished by the vote_account"
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
              "maximal number of lamports that can be claimed from this settlement"
            ],
            "type": "u64"
          },
          {
            "name": "maxMerkleNodes",
            "docs": [
              "maximal number of merkle tree nodes that can be claimed from this settlement"
            ],
            "type": "u64"
          },
          {
            "name": "rentCollector",
            "docs": [
              "collects the rent exempt from the settlement account when closed"
            ],
            "type": "publicKey"
          },
          {
            "name": "epoch",
            "docs": [
              "epoch that the settlement is created for"
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "MergeStakeArgs",
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
            "name": "stakerAuthority",
            "type": "u8"
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
          "name": "voteAccount",
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
          "name": "cpmpe",
          "type": "u64",
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
          "name": "cpmpe",
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
      "name": "CloseBondEvent",
      "fields": [
        {
          "name": "configAddress",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "voteAccount",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "authority",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "cpmpe",
          "type": "u64",
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
          "name": "voteAccount",
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
          "name": "pauseAuthority",
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
      "name": "EmergencyPauseEvent",
      "fields": [
        {
          "name": "config",
          "type": "publicKey",
          "index": false
        },
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
          "name": "epochsToClaimSettlement",
          "type": "u64",
          "index": false
        },
        {
          "name": "withdrawLockupEpochs",
          "type": "u64",
          "index": false
        },
        {
          "name": "minimumStakeLamports",
          "type": "u64",
          "index": false
        },
        {
          "name": "pauseAuthority",
          "type": "publicKey",
          "index": false
        }
      ]
    },
    {
      "name": "EmergencyResumeEvent",
      "fields": [
        {
          "name": "config",
          "type": "publicKey",
          "index": false
        },
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
          "name": "epochsToClaimSettlement",
          "type": "u64",
          "index": false
        },
        {
          "name": "withdrawLockupEpochs",
          "type": "u64",
          "index": false
        },
        {
          "name": "minimumStakeLamports",
          "type": "u64",
          "index": false
        },
        {
          "name": "pauseAuthority",
          "type": "publicKey",
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
          "name": "settlementLamportsClaimed",
          "type": "u64",
          "index": false
        },
        {
          "name": "settlementMerkleNodesClaimed",
          "type": "u64",
          "index": false
        },
        {
          "name": "stakeAccountTo",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "stakeAccountWithdrawer",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "stakeAccountStaker",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "amount",
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
          "name": "stakerAuthority",
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
          "name": "maxMerkleNodes",
          "type": "u64",
          "index": false
        },
        {
          "name": "epochCreatedFor",
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
          "name": "maxMerkleNodes",
          "type": "u64",
          "index": false
        },
        {
          "name": "lamportsFunded",
          "type": "u64",
          "index": false
        },
        {
          "name": "lamportsClaimed",
          "type": "u64",
          "index": false
        },
        {
          "name": "merkleNodesClaimed",
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
          "name": "splitRentRefundAccount",
          "type": "publicKey",
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
          "name": "lamportsFunded",
          "type": "u64",
          "index": false
        },
        {
          "name": "lamportsClaimed",
          "type": "u64",
          "index": false
        },
        {
          "name": "merkleNodesClaimed",
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
      "name": "MergeStakeEvent",
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
      "name": "ResetStakeEvent",
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
          "name": "voteAccount",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "settlementStakerAuthority",
          "type": "publicKey",
          "index": false
        }
      ]
    },
    {
      "name": "WithdrawStakeEvent",
      "fields": [
        {
          "name": "config",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "operatorAuthority",
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
          "name": "withdrawTo",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "settlementStakerAuthority",
          "type": "publicKey",
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
      "name": "InitWithdrawRequestEvent",
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
          "name": "voteAccount",
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
          "name": "voteAccount",
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
      "name": "InvalidStakeAccountState",
      "msg": "Fail to deserialize the stake account"
    },
    {
      "code": 6006,
      "name": "InvalidStakeAccountProgramId",
      "msg": "Provided stake account is not owned by the stake account program"
    },
    {
      "code": 6007,
      "name": "InvalidSettlementAddress",
      "msg": "Fail to create account address for Settlement"
    },
    {
      "code": 6008,
      "name": "InvalidSettlementAuthorityAddress",
      "msg": "Fail to create PDA address for Settlement Authority"
    },
    {
      "code": 6009,
      "name": "InvalidBondsWithdrawerAuthorityAddress",
      "msg": "Fail to create PDA address for Bonds Withdrawer Authority"
    },
    {
      "code": 6010,
      "name": "InvalidSettlementClaimAddress",
      "msg": "Fail to create program address for SettlementClaim"
    },
    {
      "code": 6011,
      "name": "InvalidBondAddress",
      "msg": "Fail to create program address for Bond"
    },
    {
      "code": 6012,
      "name": "WrongStakeAccountWithdrawer",
      "msg": "Wrong withdrawer authority of the stake account"
    },
    {
      "code": 6013,
      "name": "InvalidWithdrawRequestAddress",
      "msg": "Fail to create program address for WithdrawRequest"
    },
    {
      "code": 6014,
      "name": "HundredthBasisPointsOverflow",
      "msg": "Value of hundredth basis points is too big"
    },
    {
      "code": 6015,
      "name": "HundredthBasisPointsCalculation",
      "msg": "Hundredth basis points calculation failure"
    },
    {
      "code": 6016,
      "name": "HundredthBasisPointsParse",
      "msg": "Hundredth basis points failure to parse the value"
    },
    {
      "code": 6017,
      "name": "FailedToDeserializeVoteAccount",
      "msg": "Cannot deserialize validator vote account data"
    },
    {
      "code": 6018,
      "name": "BondChangeNotPermitted",
      "msg": "Wrong authority for changing the validator bond account"
    },
    {
      "code": 6019,
      "name": "StakeNotDelegated",
      "msg": "Provided stake cannot be used for bonds, it's not delegated"
    },
    {
      "code": 6020,
      "name": "BondStakeWrongDelegation",
      "msg": "Provided stake is delegated to a wrong validator vote account"
    },
    {
      "code": 6021,
      "name": "WithdrawRequestNotReady",
      "msg": "Withdraw request has not elapsed the epoch lockup period yet"
    },
    {
      "code": 6022,
      "name": "SettlementNotExpired",
      "msg": "Settlement has not expired yet"
    },
    {
      "code": 6023,
      "name": "SettlementExpired",
      "msg": "Settlement has already expired"
    },
    {
      "code": 6024,
      "name": "UninitializedStake",
      "msg": "Stake is not initialized"
    },
    {
      "code": 6025,
      "name": "NoStakeOrNotFullyActivated",
      "msg": "Stake account is not fully activated"
    },
    {
      "code": 6026,
      "name": "UnexpectedRemainingAccounts",
      "msg": "Instruction context was provided with unexpected set of remaining accounts"
    },
    {
      "code": 6027,
      "name": "SettlementNotClosed",
      "msg": "Settlement has to be closed"
    },
    {
      "code": 6028,
      "name": "StakeAccountIsFundedToSettlement",
      "msg": "Provided stake account has been already funded to a settlement"
    },
    {
      "code": 6029,
      "name": "ClaimSettlementProofFailed",
      "msg": "Settlement claim proof failed"
    },
    {
      "code": 6030,
      "name": "StakeLockedUp",
      "msg": "Provided stake account is locked-up"
    },
    {
      "code": 6031,
      "name": "StakeAccountNotBigEnoughToSplit",
      "msg": "Stake account is not big enough to be split"
    },
    {
      "code": 6032,
      "name": "ClaimAmountExceedsMaxTotalClaim",
      "msg": "Claiming bigger amount than the max total claim"
    },
    {
      "code": 6033,
      "name": "ClaimCountExceedsMaxMerkleNodes",
      "msg": "Claim exceeded number of claimable nodes in the merkle tree"
    },
    {
      "code": 6034,
      "name": "EmptySettlementMerkleTree",
      "msg": "Empty merkle tree, nothing to be claimed"
    },
    {
      "code": 6035,
      "name": "ClaimingStakeAccountLamportsInsufficient",
      "msg": "Provided stake account has not enough lamports to cover the claim"
    },
    {
      "code": 6036,
      "name": "StakeAccountNotFundedToSettlement",
      "msg": "Provided stake account is not funded under the settlement"
    },
    {
      "code": 6037,
      "name": "VoteAccountValidatorIdentityMismatch",
      "msg": "Validator vote account does not match to provided validator identity signature"
    },
    {
      "code": 6038,
      "name": "VoteAccountMismatch",
      "msg": "Bond vote account address does not match with the provided validator vote account"
    },
    {
      "code": 6039,
      "name": "ConfigAccountMismatch",
      "msg": "Bond config address does not match with the provided config account"
    },
    {
      "code": 6040,
      "name": "WithdrawRequestVoteAccountMismatch",
      "msg": "Withdraw request vote account address does not match with the provided validator vote account"
    },
    {
      "code": 6041,
      "name": "BondAccountMismatch",
      "msg": "Bond account address does not match with the stored one"
    },
    {
      "code": 6042,
      "name": "SettlementAccountMismatch",
      "msg": "Settlement account address does not match with the stored one"
    },
    {
      "code": 6043,
      "name": "RentCollectorMismatch",
      "msg": "Rent collector address does not match permitted rent collector"
    },
    {
      "code": 6044,
      "name": "StakerAuthorityMismatch",
      "msg": "Stake account's staker does not match with the provided authority"
    },
    {
      "code": 6045,
      "name": "NonBondStakeAuthorities",
      "msg": "One or both stake authorities does not belong to bonds program"
    },
    {
      "code": 6046,
      "name": "SettlementAuthorityMismatch",
      "msg": "Stake account staker authority mismatches with the settlement authority"
    },
    {
      "code": 6047,
      "name": "StakeDelegationMismatch",
      "msg": "Delegation of provided stake account mismatches"
    },
    {
      "code": 6048,
      "name": "WithdrawRequestAmountTooSmall",
      "msg": "Too small non-withdrawn withdraw request amount, cancel and init new one"
    },
    {
      "code": 6049,
      "name": "WithdrawRequestAlreadyFulfilled",
      "msg": "Withdraw request has been already fulfilled"
    },
    {
      "code": 6050,
      "name": "ClaimSettlementMerkleTreeNodeMismatch",
      "msg": "Claim settlement merkle tree node mismatch"
    },
    {
      "code": 6051,
      "name": "WrongStakeAccountStaker",
      "msg": "Wrong staker authority of the stake account"
    },
    {
      "code": 6052,
      "name": "AlreadyPaused",
      "msg": "Requested pause and already Paused"
    },
    {
      "code": 6053,
      "name": "NotPaused",
      "msg": "Requested resume, but not Paused"
    },
    {
      "code": 6054,
      "name": "ProgramIsPaused",
      "msg": "Emergency Pause is Active"
    },
    {
      "code": 6055,
      "name": "InvalidPauseAuthority",
      "msg": "Invalid pause authority"
    },
    {
      "code": 6056,
      "name": "MergeMismatchSameSourceDestination",
      "msg": "Source and destination cannot be the same for merge operation"
    },
    {
      "code": 6057,
      "name": "WrongStakeAccountState",
      "msg": "Wrong state of the stake account"
    }
  ]
};

export const IDL: ValidatorBonds = {
  "version": "1.1.0",
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
      "name": "BONDS_WITHDRAWER_AUTHORITY_SEED",
      "type": "bytes",
      "value": "[98, 111, 110, 100, 115, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121]"
    },
    {
      "name": "SETTLEMENT_STAKER_AUTHORITY_SEED",
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
          "name": "voteAccount",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "validatorIdentity",
          "isMut": false,
          "isSigner": true,
          "isOptional": true,
          "docs": [
            "when validator identity signs the instruction then configuration arguments are applied",
            "otherwise it's a permission-less operation that uses default init bond setup"
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
                "path": "vote_account"
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
          "name": "config",
          "isMut": false,
          "isSigner": false
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
                "path": "vote_account"
              }
            ]
          },
          "relations": [
            "vote_account",
            "config"
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
          "name": "voteAccount",
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
                "path": "bond.vote_account"
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
                "path": "vote_account"
              }
            ]
          },
          "relations": [
            "config",
            "vote_account"
          ]
        },
        {
          "name": "voteAccount",
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
          "name": "config",
          "isMut": false,
          "isSigner": false
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
                "path": "vote_account"
              }
            ]
          },
          "relations": [
            "vote_account",
            "config"
          ]
        },
        {
          "name": "voteAccount",
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
                "value": "withdraw_account"
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
                "path": "vote_account"
              }
            ]
          },
          "relations": [
            "config",
            "vote_account"
          ]
        },
        {
          "name": "voteAccount",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "authority",
          "isMut": false,
          "isSigner": true,
          "docs": [
            "validator vote account node identity or bond authority may claim"
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
          },
          "relations": [
            "vote_account",
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
            "New owner of the stake account, it will be accounted to the withdrawer authority"
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
                "kind": "account",
                "type": "publicKey",
                "account": "Bond",
                "path": "bond.vote_account"
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
                "kind": "arg",
                "type": {
                  "defined": "InitSettlementArgs"
                },
                "path": "params.merkle_root"
              },
              {
                "kind": "arg",
                "type": {
                  "defined": "InitSettlementArgs"
                },
                "path": "params.epoch"
              }
            ]
          }
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
                "path": "bond.vote_account"
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
                "path": "settlement.epoch_created_for"
              }
            ]
          },
          "relations": [
            "bond",
            "rent_collector"
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
          "name": "splitRentRefundAccount",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "a stake account that was funded to the settlement credited to bond's validator vote account",
            "lamports of the stake accounts are used to pay back rent exempt of the split_stake_account",
            "that can be created on funding the settlement"
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
                "path": "bond.vote_account"
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
                "path": "settlement.epoch_created_for"
              }
            ]
          },
          "relations": [
            "bond"
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
          "name": "settlementStakerAuthority",
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
            "an account that does not exist, it will be initialized as a stake account (the signature needed)",
            "the split_stake_account is needed when the provided stake_account is consists of more lamports",
            "than the amount needed to fund the settlement, the left-over lamports from the stake account is split",
            "into the new split_stake_account; when the split_stake_account is not needed, the rent payer is refunded"
          ]
        },
        {
          "name": "splitStakeRentPayer",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "rent exempt payer of the split_stake_account creation",
            "if the split_stake_account is not needed (no left-over lamports on funding) then rent payer is refunded",
            "it the split_stake_account is needed to spill out over funding of the settlement",
            "then the rent payer is refunded when the settlement is closed"
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
                "kind": "account",
                "type": "publicKey",
                "account": "Bond",
                "path": "bond.vote_account"
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
                "path": "settlement.epoch_created_for"
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
                "path": "params.tree_node_hash"
              }
            ]
          }
        },
        {
          "name": "stakeAccountFrom",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "a stake account which will be withdrawn"
          ]
        },
        {
          "name": "stakeAccountTo",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "a stake account that will receive the funds"
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
      "name": "mergeStake",
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
            "defined": "MergeStakeArgs"
          }
        }
      ]
    },
    {
      "name": "resetStake",
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
                "path": "vote_account"
              }
            ]
          },
          "relations": [
            "config",
            "vote_account"
          ]
        },
        {
          "name": "settlement",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "settlement account used to derive settlement authority which cannot exists"
          ]
        },
        {
          "name": "stakeAccount",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "stake account belonging under the settlement by staker authority"
          ]
        },
        {
          "name": "bondsWithdrawerAuthority",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "bonds withdrawer authority",
            "to cancel settlement funding of the stake account changing staker authority to address"
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
          "name": "voteAccount",
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
    },
    {
      "name": "withdrawStake",
      "accounts": [
        {
          "name": "config",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "the config root account under which the bond was created"
          ],
          "relations": [
            "operator_authority"
          ]
        },
        {
          "name": "operatorAuthority",
          "isMut": false,
          "isSigner": true,
          "docs": [
            "operator authority is allowed to reset the non-delegated stake accounts"
          ]
        },
        {
          "name": "settlement",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "settlement account used to derive settlement authority which cannot exists"
          ]
        },
        {
          "name": "stakeAccount",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "stake account where staker authority is of the settlement"
          ]
        },
        {
          "name": "bondsWithdrawerAuthority",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "bonds withdrawer authority",
            "to cancel settlement funding of the stake account changing staker authority to address"
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
          "name": "withdrawTo",
          "isMut": true,
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
      "args": []
    },
    {
      "name": "emergencyPause",
      "accounts": [
        {
          "name": "config",
          "isMut": true,
          "isSigner": false,
          "relations": [
            "pause_authority"
          ]
        },
        {
          "name": "pauseAuthority",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": []
    },
    {
      "name": "emergencyResume",
      "accounts": [
        {
          "name": "config",
          "isMut": true,
          "isSigner": false,
          "relations": [
            "pause_authority"
          ]
        },
        {
          "name": "pauseAuthority",
          "isMut": false,
          "isSigner": true
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
            "name": "voteAccount",
            "docs": [
              "Validator vote address that this bond account is crated for",
              "INVARIANTS:",
              "- one bond account per validator vote address",
              "- this program does NOT change stake account delegation voter_pubkey to any other validator vote account"
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
            "name": "cpmpe",
            "docs": [
              "Cost per mille per epoch"
            ],
            "type": "u64"
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
              "array": [
                "u8",
                142
              ]
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
              "PDA bonds stake accounts authority bump seed"
            ],
            "type": "u8"
          },
          {
            "name": "pauseAuthority",
            "docs": [
              "Authority that can pause the program in case of emergency"
            ],
            "type": "publicKey"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "reserved",
            "docs": [
              "reserved space for future changes"
            ],
            "type": {
              "array": [
                "u8",
                479
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
            "name": "stakeAccountTo",
            "docs": [
              "stake account to which the claim has been withdrawn to"
            ],
            "type": "publicKey"
          },
          {
            "name": "stakeAccountStaker",
            "docs": [
              "staker authority as part of the merkle proof for this claim"
            ],
            "type": "publicKey"
          },
          {
            "name": "stakeAccountWithdrawer",
            "docs": [
              "withdrawer authority as part of the merkle proof for this claim"
            ],
            "type": "publicKey"
          },
          {
            "name": "amount",
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
              "array": [
                "u8",
                93
              ]
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
            "name": "stakerAuthority",
            "docs": [
              "settlement authority used as the 'staker' stake account authority",
              "of stake accounts funded to this settlement"
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
            "name": "maxMerkleNodes",
            "docs": [
              "maximum number of merkle tree nodes that can ever be claimed from this [Settlement]"
            ],
            "type": "u64"
          },
          {
            "name": "lamportsFunded",
            "docs": [
              "total lamports funded to this [Settlement]"
            ],
            "type": "u64"
          },
          {
            "name": "lamportsClaimed",
            "docs": [
              "total lamports that have been claimed from this [Settlement]"
            ],
            "type": "u64"
          },
          {
            "name": "merkleNodesClaimed",
            "docs": [
              "number of nodes that have been claimed from this [Settlement]"
            ],
            "type": "u64"
          },
          {
            "name": "epochCreatedFor",
            "docs": [
              "what epoch the [Settlement] has been created for"
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
              "address claiming the rent exempt for \"split stake account\" created on funding settlement"
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
              "array": [
                "u8",
                99
              ]
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
            "name": "voteAccount",
            "docs": [
              "Validator vote account that requested the withdraw"
            ],
            "type": "publicKey"
          },
          {
            "name": "bond",
            "docs": [
              "Bond account that the withdraw request is for (has to match with vote_account)"
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
              "array": [
                "u8",
                93
              ]
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
            "name": "cpmpe",
            "type": {
              "option": "u64"
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
            "name": "cpmpe",
            "type": "u64"
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
            "name": "pauseAuthority",
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
            "name": "proof",
            "docs": [
              "proof that the claim is appropriate"
            ],
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
            "name": "treeNodeHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "stakeAccountStaker",
            "docs": [
              "staker authority of the stake_account_to; merkle root verification"
            ],
            "type": "publicKey"
          },
          {
            "name": "stakeAccountWithdrawer",
            "docs": [
              "withdrawer authority of the stake_account_to; merkle root verification"
            ],
            "type": "publicKey"
          },
          {
            "name": "claim",
            "docs": [
              "claim amount; merkle root verification"
            ],
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
            "docs": [
              "merkle root for this settlement, multiple settlements can be created with the same merkle root,",
              "settlements will be distinguished by the vote_account"
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
              "maximal number of lamports that can be claimed from this settlement"
            ],
            "type": "u64"
          },
          {
            "name": "maxMerkleNodes",
            "docs": [
              "maximal number of merkle tree nodes that can be claimed from this settlement"
            ],
            "type": "u64"
          },
          {
            "name": "rentCollector",
            "docs": [
              "collects the rent exempt from the settlement account when closed"
            ],
            "type": "publicKey"
          },
          {
            "name": "epoch",
            "docs": [
              "epoch that the settlement is created for"
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "MergeStakeArgs",
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
            "name": "stakerAuthority",
            "type": "u8"
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
          "name": "voteAccount",
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
          "name": "cpmpe",
          "type": "u64",
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
          "name": "cpmpe",
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
      "name": "CloseBondEvent",
      "fields": [
        {
          "name": "configAddress",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "voteAccount",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "authority",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "cpmpe",
          "type": "u64",
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
          "name": "voteAccount",
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
          "name": "pauseAuthority",
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
      "name": "EmergencyPauseEvent",
      "fields": [
        {
          "name": "config",
          "type": "publicKey",
          "index": false
        },
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
          "name": "epochsToClaimSettlement",
          "type": "u64",
          "index": false
        },
        {
          "name": "withdrawLockupEpochs",
          "type": "u64",
          "index": false
        },
        {
          "name": "minimumStakeLamports",
          "type": "u64",
          "index": false
        },
        {
          "name": "pauseAuthority",
          "type": "publicKey",
          "index": false
        }
      ]
    },
    {
      "name": "EmergencyResumeEvent",
      "fields": [
        {
          "name": "config",
          "type": "publicKey",
          "index": false
        },
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
          "name": "epochsToClaimSettlement",
          "type": "u64",
          "index": false
        },
        {
          "name": "withdrawLockupEpochs",
          "type": "u64",
          "index": false
        },
        {
          "name": "minimumStakeLamports",
          "type": "u64",
          "index": false
        },
        {
          "name": "pauseAuthority",
          "type": "publicKey",
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
          "name": "settlementLamportsClaimed",
          "type": "u64",
          "index": false
        },
        {
          "name": "settlementMerkleNodesClaimed",
          "type": "u64",
          "index": false
        },
        {
          "name": "stakeAccountTo",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "stakeAccountWithdrawer",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "stakeAccountStaker",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "amount",
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
          "name": "stakerAuthority",
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
          "name": "maxMerkleNodes",
          "type": "u64",
          "index": false
        },
        {
          "name": "epochCreatedFor",
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
          "name": "maxMerkleNodes",
          "type": "u64",
          "index": false
        },
        {
          "name": "lamportsFunded",
          "type": "u64",
          "index": false
        },
        {
          "name": "lamportsClaimed",
          "type": "u64",
          "index": false
        },
        {
          "name": "merkleNodesClaimed",
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
          "name": "splitRentRefundAccount",
          "type": "publicKey",
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
          "name": "lamportsFunded",
          "type": "u64",
          "index": false
        },
        {
          "name": "lamportsClaimed",
          "type": "u64",
          "index": false
        },
        {
          "name": "merkleNodesClaimed",
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
      "name": "MergeStakeEvent",
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
      "name": "ResetStakeEvent",
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
          "name": "voteAccount",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "settlementStakerAuthority",
          "type": "publicKey",
          "index": false
        }
      ]
    },
    {
      "name": "WithdrawStakeEvent",
      "fields": [
        {
          "name": "config",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "operatorAuthority",
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
          "name": "withdrawTo",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "settlementStakerAuthority",
          "type": "publicKey",
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
      "name": "InitWithdrawRequestEvent",
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
          "name": "voteAccount",
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
          "name": "voteAccount",
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
      "name": "InvalidStakeAccountState",
      "msg": "Fail to deserialize the stake account"
    },
    {
      "code": 6006,
      "name": "InvalidStakeAccountProgramId",
      "msg": "Provided stake account is not owned by the stake account program"
    },
    {
      "code": 6007,
      "name": "InvalidSettlementAddress",
      "msg": "Fail to create account address for Settlement"
    },
    {
      "code": 6008,
      "name": "InvalidSettlementAuthorityAddress",
      "msg": "Fail to create PDA address for Settlement Authority"
    },
    {
      "code": 6009,
      "name": "InvalidBondsWithdrawerAuthorityAddress",
      "msg": "Fail to create PDA address for Bonds Withdrawer Authority"
    },
    {
      "code": 6010,
      "name": "InvalidSettlementClaimAddress",
      "msg": "Fail to create program address for SettlementClaim"
    },
    {
      "code": 6011,
      "name": "InvalidBondAddress",
      "msg": "Fail to create program address for Bond"
    },
    {
      "code": 6012,
      "name": "WrongStakeAccountWithdrawer",
      "msg": "Wrong withdrawer authority of the stake account"
    },
    {
      "code": 6013,
      "name": "InvalidWithdrawRequestAddress",
      "msg": "Fail to create program address for WithdrawRequest"
    },
    {
      "code": 6014,
      "name": "HundredthBasisPointsOverflow",
      "msg": "Value of hundredth basis points is too big"
    },
    {
      "code": 6015,
      "name": "HundredthBasisPointsCalculation",
      "msg": "Hundredth basis points calculation failure"
    },
    {
      "code": 6016,
      "name": "HundredthBasisPointsParse",
      "msg": "Hundredth basis points failure to parse the value"
    },
    {
      "code": 6017,
      "name": "FailedToDeserializeVoteAccount",
      "msg": "Cannot deserialize validator vote account data"
    },
    {
      "code": 6018,
      "name": "BondChangeNotPermitted",
      "msg": "Wrong authority for changing the validator bond account"
    },
    {
      "code": 6019,
      "name": "StakeNotDelegated",
      "msg": "Provided stake cannot be used for bonds, it's not delegated"
    },
    {
      "code": 6020,
      "name": "BondStakeWrongDelegation",
      "msg": "Provided stake is delegated to a wrong validator vote account"
    },
    {
      "code": 6021,
      "name": "WithdrawRequestNotReady",
      "msg": "Withdraw request has not elapsed the epoch lockup period yet"
    },
    {
      "code": 6022,
      "name": "SettlementNotExpired",
      "msg": "Settlement has not expired yet"
    },
    {
      "code": 6023,
      "name": "SettlementExpired",
      "msg": "Settlement has already expired"
    },
    {
      "code": 6024,
      "name": "UninitializedStake",
      "msg": "Stake is not initialized"
    },
    {
      "code": 6025,
      "name": "NoStakeOrNotFullyActivated",
      "msg": "Stake account is not fully activated"
    },
    {
      "code": 6026,
      "name": "UnexpectedRemainingAccounts",
      "msg": "Instruction context was provided with unexpected set of remaining accounts"
    },
    {
      "code": 6027,
      "name": "SettlementNotClosed",
      "msg": "Settlement has to be closed"
    },
    {
      "code": 6028,
      "name": "StakeAccountIsFundedToSettlement",
      "msg": "Provided stake account has been already funded to a settlement"
    },
    {
      "code": 6029,
      "name": "ClaimSettlementProofFailed",
      "msg": "Settlement claim proof failed"
    },
    {
      "code": 6030,
      "name": "StakeLockedUp",
      "msg": "Provided stake account is locked-up"
    },
    {
      "code": 6031,
      "name": "StakeAccountNotBigEnoughToSplit",
      "msg": "Stake account is not big enough to be split"
    },
    {
      "code": 6032,
      "name": "ClaimAmountExceedsMaxTotalClaim",
      "msg": "Claiming bigger amount than the max total claim"
    },
    {
      "code": 6033,
      "name": "ClaimCountExceedsMaxMerkleNodes",
      "msg": "Claim exceeded number of claimable nodes in the merkle tree"
    },
    {
      "code": 6034,
      "name": "EmptySettlementMerkleTree",
      "msg": "Empty merkle tree, nothing to be claimed"
    },
    {
      "code": 6035,
      "name": "ClaimingStakeAccountLamportsInsufficient",
      "msg": "Provided stake account has not enough lamports to cover the claim"
    },
    {
      "code": 6036,
      "name": "StakeAccountNotFundedToSettlement",
      "msg": "Provided stake account is not funded under the settlement"
    },
    {
      "code": 6037,
      "name": "VoteAccountValidatorIdentityMismatch",
      "msg": "Validator vote account does not match to provided validator identity signature"
    },
    {
      "code": 6038,
      "name": "VoteAccountMismatch",
      "msg": "Bond vote account address does not match with the provided validator vote account"
    },
    {
      "code": 6039,
      "name": "ConfigAccountMismatch",
      "msg": "Bond config address does not match with the provided config account"
    },
    {
      "code": 6040,
      "name": "WithdrawRequestVoteAccountMismatch",
      "msg": "Withdraw request vote account address does not match with the provided validator vote account"
    },
    {
      "code": 6041,
      "name": "BondAccountMismatch",
      "msg": "Bond account address does not match with the stored one"
    },
    {
      "code": 6042,
      "name": "SettlementAccountMismatch",
      "msg": "Settlement account address does not match with the stored one"
    },
    {
      "code": 6043,
      "name": "RentCollectorMismatch",
      "msg": "Rent collector address does not match permitted rent collector"
    },
    {
      "code": 6044,
      "name": "StakerAuthorityMismatch",
      "msg": "Stake account's staker does not match with the provided authority"
    },
    {
      "code": 6045,
      "name": "NonBondStakeAuthorities",
      "msg": "One or both stake authorities does not belong to bonds program"
    },
    {
      "code": 6046,
      "name": "SettlementAuthorityMismatch",
      "msg": "Stake account staker authority mismatches with the settlement authority"
    },
    {
      "code": 6047,
      "name": "StakeDelegationMismatch",
      "msg": "Delegation of provided stake account mismatches"
    },
    {
      "code": 6048,
      "name": "WithdrawRequestAmountTooSmall",
      "msg": "Too small non-withdrawn withdraw request amount, cancel and init new one"
    },
    {
      "code": 6049,
      "name": "WithdrawRequestAlreadyFulfilled",
      "msg": "Withdraw request has been already fulfilled"
    },
    {
      "code": 6050,
      "name": "ClaimSettlementMerkleTreeNodeMismatch",
      "msg": "Claim settlement merkle tree node mismatch"
    },
    {
      "code": 6051,
      "name": "WrongStakeAccountStaker",
      "msg": "Wrong staker authority of the stake account"
    },
    {
      "code": 6052,
      "name": "AlreadyPaused",
      "msg": "Requested pause and already Paused"
    },
    {
      "code": 6053,
      "name": "NotPaused",
      "msg": "Requested resume, but not Paused"
    },
    {
      "code": 6054,
      "name": "ProgramIsPaused",
      "msg": "Emergency Pause is Active"
    },
    {
      "code": 6055,
      "name": "InvalidPauseAuthority",
      "msg": "Invalid pause authority"
    },
    {
      "code": 6056,
      "name": "MergeMismatchSameSourceDestination",
      "msg": "Source and destination cannot be the same for merge operation"
    },
    {
      "code": 6057,
      "name": "WrongStakeAccountState",
      "msg": "Wrong state of the stake account"
    }
  ]
};
