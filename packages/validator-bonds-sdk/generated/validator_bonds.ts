export type ValidatorBonds = {
  "version": "0.1.0",
  "name": "validator_bonds",
  "constants": [
    {
      "name": "PROGRAM_ID",
      "type": "string",
      "value": "\"vbondsKbsC4QSLQQnn6ngZvkqfywn6KgEeQbkGSpk1V\""
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
            "config root account that will be created"
          ]
        },
        {
          "name": "rentPayer",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "rent exempt payer of root config account creation"
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
          "name": "initConfig",
          "type": {
            "defined": "InitConfigArgs"
          }
        }
      ]
    }
  ],
  "accounts": [
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
              "admin authority that can update the config"
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
            "name": "claimSettlementAfterEpochs",
            "docs": [
              "How many epochs to claim the settlement"
            ],
            "type": "u64"
          },
          {
            "name": "withdrawLockupEpochs",
            "docs": [
              "How many epochs before withdraw is allowed"
            ],
            "type": "u64"
          }
        ]
      }
    }
  ],
  "types": [
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
            "name": "claimSettlementAfterEpochs",
            "type": "u64"
          },
          {
            "name": "withdrawLockupEpochs",
            "type": "u64"
          }
        ]
      }
    }
  ],
  "events": [
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
          "name": "claimSettlementAfterEpochs",
          "type": "u64",
          "index": false
        },
        {
          "name": "withdrawLockupEpochs",
          "type": "u64",
          "index": false
        }
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "CustomError",
      "msg": "Custom error message"
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
      "value": "\"vbondsKbsC4QSLQQnn6ngZvkqfywn6KgEeQbkGSpk1V\""
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
            "config root account that will be created"
          ]
        },
        {
          "name": "rentPayer",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "rent exempt payer of root config account creation"
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
          "name": "initConfig",
          "type": {
            "defined": "InitConfigArgs"
          }
        }
      ]
    }
  ],
  "accounts": [
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
              "admin authority that can update the config"
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
            "name": "claimSettlementAfterEpochs",
            "docs": [
              "How many epochs to claim the settlement"
            ],
            "type": "u64"
          },
          {
            "name": "withdrawLockupEpochs",
            "docs": [
              "How many epochs before withdraw is allowed"
            ],
            "type": "u64"
          }
        ]
      }
    }
  ],
  "types": [
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
            "name": "claimSettlementAfterEpochs",
            "type": "u64"
          },
          {
            "name": "withdrawLockupEpochs",
            "type": "u64"
          }
        ]
      }
    }
  ],
  "events": [
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
          "name": "claimSettlementAfterEpochs",
          "type": "u64",
          "index": false
        },
        {
          "name": "withdrawLockupEpochs",
          "type": "u64",
          "index": false
        }
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "CustomError",
      "msg": "Custom error message"
    }
  ]
};
