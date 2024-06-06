use anchor_client::anchor_lang::AccountDeserialize;
use anyhow::anyhow;
use solana_sdk::account::Account;
use validator_bonds::state::settlement_claims::SettlementClaims;
use validator_bonds::utils::BitmapProjection;

pub struct SettlementClaimsBitmap {
    data: Vec<u8>,
    bitmap_projection: BitmapProjection,
}

impl SettlementClaimsBitmap {
    pub fn new(account: Account) -> anyhow::Result<Self> {
        let data = account.data.to_vec();
        let settlement_claims = SettlementClaims::try_deserialize(&mut data.as_slice())
            .map_or_else(
                |e| Err(anyhow!("Cannot deserialize SettlementClaims data: {}", e)),
                Ok,
            )?;
        BitmapProjection::check_size(settlement_claims.max_records, &data)?;
        let bitmap_projection = BitmapProjection(settlement_claims.max_records);
        Ok(Self {
            data,
            bitmap_projection,
        })
    }

    pub fn is_set(&self, index: u64) -> bool {
        self.bitmap_projection
            .is_set(index, &self.data)
            .expect("BitmapProjection should be initialized, checked in new()")
    }

    pub fn number_of_set_bits(&mut self) -> u64 {
        self.bitmap_projection
            .number_of_bits(&self.data)
            .expect("SettlementClaimsBitmap should be initialized, checked in new()")
    }
}
