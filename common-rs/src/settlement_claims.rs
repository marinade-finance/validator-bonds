use anchor_client::anchor_lang::AccountDeserialize;
use anyhow::anyhow;
use solana_sdk::account::Account;
use std::fmt::Debug;
use validator_bonds::constants::SETTLEMENT_CLAIMS_ANCHOR_HEADER_SIZE;
use validator_bonds::state::settlement_claims::SettlementClaims;
use validator_bonds::utils::BitmapProjection;

/// Off-chain handler for accessing bitmap from SettlementClaims account
/// The struct stores memory "copied" from the loaded Solana account.
/// The struct provides methods redirecting to [BitmapProjection] to access the bitmap data.
pub struct SettlementClaimsBitmap {
    pub data: Vec<u8>,
    bitmap_projection: BitmapProjection,
}

impl SettlementClaimsBitmap {
    pub fn new(account: Account) -> anyhow::Result<Self> {
        let mut data = account.data.to_vec();
        let settlement_claims = SettlementClaims::try_deserialize(&mut data.as_slice())
            .map_or_else(
                |e| Err(anyhow!("Cannot deserialize SettlementClaims data: {e}")),
                Ok,
            )?;
        data.drain(0..SETTLEMENT_CLAIMS_ANCHOR_HEADER_SIZE as usize);
        BitmapProjection::check_size(settlement_claims.max_records, &data)?;
        let bitmap_projection = BitmapProjection(settlement_claims.max_records);
        Ok(Self {
            data,
            bitmap_projection,
        })
    }

    pub fn max_records(&self) -> u64 {
        self.bitmap_projection.0
    }

    pub fn is_set(&self, index: u64) -> bool {
        self.bitmap_projection
            .is_set(index, &self.data)
            .expect("BitmapProjection should be initialized, checked in new()")
    }

    pub fn number_of_set_bits(&self) -> u64 {
        self.bitmap_projection
            .number_of_bits(&self.data)
            .expect("SettlementClaimsBitmap should be initialized, checked in new()")
    }
}

impl Debug for SettlementClaimsBitmap {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SettlementClaimsBitmap")
            .field("set_bits", &self.number_of_set_bits())
            .field(
                "bitmap_projection",
                &self.bitmap_projection.debug_string(&self.data),
            )
            .finish()
    }
}
