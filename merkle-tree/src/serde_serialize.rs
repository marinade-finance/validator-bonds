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
        let mut map = serializer.serialize_map(Some(stake_accounts.len()))?;
        for (k, v) in stake_accounts {
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
