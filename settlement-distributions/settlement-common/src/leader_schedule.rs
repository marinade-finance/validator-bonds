use {
    crate::utils::{file_error, read_from_json_file},
    anyhow::{bail, ensure},
    snapshot_parser_validator_cli::leader_schedule::LeaderScheduleEntry,
    solana_sdk::pubkey::Pubkey,
    std::{borrow::Cow, collections::HashMap, path::Path},
};

const NUM_CONSECUTIVE_LEADER_SLOTS: u64 = 4;

// Agave skips each validator's first leader window in these epochs (agave#16302)
pub const FIRST_LEADER_WINDOW_SKIP_EPOCHS: [u64; 8] =
    [1065, 1066, 1067, 1068, 1069, 1070, 1071, 1072];

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LeaderSlots {
    pub per_vote_account: HashMap<Pubkey, u64>,
    pub total_slots: u64,
}

impl LeaderSlots {
    pub fn without_first_window(&self, epoch: u64) -> Cow<'_, LeaderSlots> {
        if !FIRST_LEADER_WINDOW_SKIP_EPOCHS.contains(&epoch) {
            return Cow::Borrowed(self);
        }
        let per_vote_account: HashMap<Pubkey, u64> = self
            .per_vote_account
            .iter()
            .map(|(vote_account, slots)| {
                (
                    *vote_account,
                    slots.saturating_sub(NUM_CONSECUTIVE_LEADER_SLOTS),
                )
            })
            .collect();
        let removed: u64 = self
            .per_vote_account
            .iter()
            .map(|(vote_account, slots)| slots - per_vote_account[vote_account])
            .sum();
        Cow::Owned(LeaderSlots {
            per_vote_account,
            total_slots: self.total_slots - removed,
        })
    }
}

pub fn load_leader_slot_counts(path: &Path, expected_epoch: u64) -> anyhow::Result<LeaderSlots> {
    let entries: Vec<LeaderScheduleEntry> = read_from_json_file(&path)
        .map_err(file_error("leader-schedule", &path.to_string_lossy()))?;
    leader_slot_counts(&entries, expected_epoch)
}

fn leader_slot_counts(
    entries: &[LeaderScheduleEntry],
    expected_epoch: u64,
) -> anyhow::Result<LeaderSlots> {
    ensure!(!entries.is_empty(), "Leader schedule has no entries");
    let mut per_vote_account: HashMap<Pubkey, u64> = HashMap::new();
    for entry in entries {
        if entry.epoch != expected_epoch {
            bail!(
                "Leader schedule row for slot {} is of epoch {}, expected {expected_epoch}",
                entry.slot,
                entry.epoch
            );
        }
        *per_vote_account.entry(entry.vote_pubkey).or_default() += 1;
    }
    Ok(LeaderSlots {
        per_vote_account,
        total_slots: entries.len() as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(epoch: u64, slot: u64, vote_pubkey: Pubkey) -> LeaderScheduleEntry {
        LeaderScheduleEntry {
            epoch,
            slot,
            vote_pubkey,
            node_pubkey: Pubkey::default(),
            vintage_epoch_stakes_key: epoch,
            vintage_captured_at_epoch: epoch - 2,
        }
    }

    #[test]
    fn counts_leader_slots_per_vote_account() {
        let (a, b, c) = (
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
        );
        let entries: Vec<_> = [a, a, a, b, b, c]
            .into_iter()
            .enumerate()
            .map(|(i, v)| entry(1100, 475_200_000 + i as u64, v))
            .collect();
        let slots = leader_slot_counts(&entries, 1100).unwrap();
        assert_eq!(slots.total_slots, 6);
        assert_eq!(
            slots.per_vote_account,
            HashMap::from([(a, 3), (b, 2), (c, 1)])
        );
    }

    #[test]
    fn drops_the_first_window_in_the_agave_skip_epochs() {
        let (a, b, c) = (
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
        );
        let scheduled = LeaderSlots {
            per_vote_account: HashMap::from([(a, 12), (b, 4), (c, 1)]),
            total_slots: 17,
        };
        for epoch in FIRST_LEADER_WINDOW_SKIP_EPOCHS {
            assert_eq!(
                *scheduled.without_first_window(epoch),
                LeaderSlots {
                    per_vote_account: HashMap::from([(a, 8), (b, 0), (c, 0)]),
                    total_slots: 8,
                },
                "epoch {epoch}"
            );
        }
        for epoch in [1064, 1073, 1100] {
            assert!(matches!(
                scheduled.without_first_window(epoch),
                Cow::Borrowed(slots) if *slots == scheduled
            ));
        }
    }

    #[test]
    fn rejects_a_row_of_another_epoch() {
        let v = Pubkey::new_unique();
        let entries = vec![entry(1100, 1, v), entry(1101, 2, v)];
        let err = leader_slot_counts(&entries, 1100).unwrap_err();
        assert!(err.to_string().contains("is of epoch 1101"), "{err}");
    }

    #[test]
    fn rejects_an_empty_schedule() {
        assert!(leader_slot_counts(&[], 1100).is_err());
    }
}
