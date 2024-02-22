use std::{
    fs::File,
    io::{BufReader, BufWriter, Write},
};

use serde::{de::DeserializeOwned, Serialize};

pub fn write_to_json_file<T: Serialize>(data: &T, out_path: &str) -> anyhow::Result<()> {
    let file = File::create(out_path)?;
    let mut writer = BufWriter::new(file);
    let json = serde_json::to_string_pretty(data)?;
    writer.write_all(json.as_bytes())?;
    writer.flush()?;

    Ok(())
}

pub fn read_from_json_file<T: DeserializeOwned>(in_path: &str) -> anyhow::Result<T> {
    let file = File::open(in_path)?;
    let reader = BufReader::new(file);
    let result: T = serde_json::from_reader(reader)?;

    Ok(result)
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
        solana_sdk::pubkey::Pubkey,
    };

    pub(crate) fn serialize<S, T: Serialize>(
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

    pub(crate) fn deserialize<'de, D, V: Deserialize<'de>>(
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
