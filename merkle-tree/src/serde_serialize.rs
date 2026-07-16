/// Serializes a `u64` as a plain JSON number (unchanged wire format) but
/// tolerates both a number and a decimal string on deserialize. JavaScript
/// producers/consumers cannot represent integers above 2^53-1 in a JSON
/// number, so string-encoded u64 is their only exact form — accepting it here
/// lets the JSON format migrate field-by-field without a flag-day.
pub mod u64_number_or_string {
    use serde::{self, Deserializer, Serializer};
    use std::fmt;

    pub fn serialize<S>(value: &u64, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u64(*value)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<u64, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct U64NumberOrStringVisitor;

        impl serde::de::Visitor<'_> for U64NumberOrStringVisitor {
            type Value = u64;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("a u64 as a JSON number or a decimal string")
            }

            fn visit_u64<E: serde::de::Error>(self, v: u64) -> Result<u64, E> {
                Ok(v)
            }

            fn visit_i64<E: serde::de::Error>(self, v: i64) -> Result<u64, E> {
                u64::try_from(v).map_err(E::custom)
            }

            fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<u64, E> {
                v.parse::<u64>().map_err(E::custom)
            }
        }

        deserializer.deserialize_any(U64NumberOrStringVisitor)
    }
}

pub mod pubkey_string_conversion {
    use {
        serde::{self, Deserialize, Deserializer, Serializer},
        solana_program::pubkey::Pubkey,
        std::str::FromStr,
    };

    pub fn serialize<S>(pubkey: &Pubkey, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&pubkey.to_string())
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Pubkey, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        Pubkey::from_str(&s).map_err(serde::de::Error::custom)
    }
}

pub mod option_pubkey_string_conversion {
    use super::pubkey_string_conversion;
    use serde::{Deserialize, Deserializer, Serialize, Serializer};
    use solana_program::pubkey::Pubkey;

    pub fn serialize<S>(value: &Option<Pubkey>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        #[derive(Serialize)]
        struct Helper<'a>(#[serde(with = "pubkey_string_conversion")] &'a Pubkey);

        value.as_ref().map(Helper).serialize(serializer)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Option<Pubkey>, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        struct Helper(#[serde(with = "pubkey_string_conversion")] Pubkey);

        let helper = Option::deserialize(deserializer)?;
        Ok(helper.map(|Helper(external)| external))
    }
}

pub mod map_pubkey_string_conversion {
    use serde::de::{MapAccess, Visitor};
    use serde::ser::SerializeMap;
    use serde::Serialize;
    use std::collections::HashMap;
    use std::fmt;
    use std::marker::PhantomData;
    use {
        serde::{self, Deserialize, Deserializer, Serializer},
        solana_program::pubkey::Pubkey,
    };

    pub fn serialize<S, T: Serialize>(
        stake_accounts: &HashMap<Pubkey, T>,
        serializer: S,
    ) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut sorted_entries: Vec<_> = stake_accounts.iter().collect();
        sorted_entries.sort_by_key(|(k, _)| k.to_bytes());
        let mut map = serializer.serialize_map(Some(sorted_entries.len()))?;
        for (k, v) in sorted_entries {
            map.serialize_entry(&k.to_string(), v)?;
        }
        map.end()
    }

    pub fn deserialize<'de, D, V: Deserialize<'de>>(
        deserializer: D,
    ) -> Result<HashMap<Pubkey, V>, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_map(PubkeyMapVisitor::new())
    }

    struct PubkeyMapVisitor<V> {
        marker: PhantomData<fn() -> HashMap<Pubkey, V>>,
    }

    impl<V> PubkeyMapVisitor<V> {
        fn new() -> Self {
            PubkeyMapVisitor {
                marker: PhantomData,
            }
        }
    }

    impl<'de, V> Visitor<'de> for PubkeyMapVisitor<V>
    where
        V: Deserialize<'de>,
    {
        type Value = HashMap<Pubkey, V>;

        fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter.write_str("a HashMap of Pubkey as key and V as value")
        }

        fn visit_map<M>(self, mut access: M) -> Result<Self::Value, M::Error>
        where
            M: MapAccess<'de>,
        {
            let mut map = HashMap::with_capacity(access.size_hint().unwrap_or(0));
            while let Some((key, value)) = access.next_entry::<String, V>()? {
                map.insert(key.parse().unwrap(), value);
            }

            Ok(map)
        }
    }
}

pub mod vec_pubkey_string_conversion {
    use serde::Serialize;
    use {
        serde::{self, Deserialize, Deserializer, Serializer},
        solana_program::pubkey::Pubkey,
        std::str::FromStr,
    };

    pub fn serialize<S>(pubkeys: &[Pubkey], serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        // Convert Vec<Pubkey> to Vec<String>
        let string_vec: Vec<String> = pubkeys.iter().map(|pubkey| pubkey.to_string()).collect();
        string_vec.serialize(serializer)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Vec<Pubkey>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let strings: Vec<String> = Vec::deserialize(deserializer)?;
        strings
            .into_iter()
            .map(|s| Pubkey::from_str(&s).map_err(serde::de::Error::custom))
            .collect()
    }
}

pub mod option_vec_pubkey_string_conversion {
    use serde::Serialize;
    use {
        serde::{self, Deserialize, Deserializer, Serializer},
        solana_program::pubkey::Pubkey,
        std::str::FromStr,
    };

    pub fn serialize<S>(pubkeys: &Option<Vec<Pubkey>>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let string_vec: Option<Vec<String>> = pubkeys
            .as_ref()
            .map(|vec| vec.iter().map(|pubkey| pubkey.to_string()).collect());
        string_vec.serialize(serializer)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Option<Vec<Pubkey>>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let strings: Option<Vec<String>> = Option::deserialize(deserializer)?;
        strings
            .map(|vec| {
                vec.into_iter()
                    .map(|s| Pubkey::from_str(&s).map_err(serde::de::Error::custom))
                    .collect()
            })
            .transpose()
    }
}
