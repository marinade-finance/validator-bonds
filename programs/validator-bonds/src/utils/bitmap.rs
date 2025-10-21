use crate::error::ErrorCode;
use anchor_lang::prelude::*;

const BITS_PER_BYTE: u8 = 8;

/// BitmapProjection is a projection of a bitmap data structure stored in a byte array,
/// it works with a pointer to Solana account data.
/// The projection stores the max_records number of records, max number of records expected to work with.
/// Implemented methods checks if provided data slice is large enough to store the bitmap.
pub struct BitmapProjection(pub u64);

impl BitmapProjection {
    /// Check if the provided data slice is large enough to store the bitmap.
    /// The provide data slice is expected to be only for the bitmap data (not expected any Anchor header in data here).
    pub fn check_size(max_records: u64, bitmap_data: &[u8]) -> Result<()> {
        require_gte!(
            bitmap_data.len(),
            Self::bitmap_size_in_bytes(max_records),
            ErrorCode::BitmapSizeMismatch
        );
        Ok(())
    }

    pub fn is_set(&self, index: u64, bitmap_data: &[u8]) -> Result<bool> {
        self.verify_index(index)?;
        let (byte_index, bit_index) = Self::bitmap_byte_index_and_bit_index(index);
        let bitmap_byte = self.bitmap_byte(byte_index, bitmap_data);
        Ok(bitmap_byte & (1 << (BITS_PER_BYTE - 1 - bit_index)) != 0)
    }

    pub fn set(&mut self, index: u64, bitmap_data: &mut [u8]) -> Result<()> {
        self.verify_index(index)?;
        self.set_inner(index, bitmap_data)
    }

    pub fn try_to_set(&mut self, index: u64, bitmap_data: &mut [u8]) -> Result<bool> {
        if self.is_set(index, bitmap_data)? {
            Ok(false)
        } else {
            // validity of index is checked in is_set
            self.set_inner(index, bitmap_data)?;
            Ok(true)
        }
    }

    /// calculating number of bits(!) that are set to 1 in the bitmap_bytes slice
    pub fn number_of_bits(&self, bitmap_data: &[u8]) -> Result<u64> {
        Ok(bitmap_data
            .iter()
            .map(|byte| byte.count_ones() as u64)
            .sum::<u64>())
    }

    /// number of bytes required for the bitmap to store the given number of records
    /// every record consumes 1 bit in the bitmap
    pub fn bitmap_size_in_bytes(max_records: u64) -> usize {
        let (byte_index, bit_index) = Self::bitmap_byte_index_and_bit_index(max_records);
        if bit_index == 0 {
            byte_index
        } else {
            byte_index + 1_usize
        }
    }

    pub fn debug_string(&self, bitmap_data: &[u8]) -> String {
        let (last_byte_index, last_bit_index) = Self::bitmap_byte_index_and_bit_index(self.0);
        let mut formatted_data =
                // stripping last byte only to include the bitmap data limited by max_records
                bitmap_data[..last_byte_index + if last_bit_index == 0 { 0 } else { 1 }]
                .iter()
                .map(|b| format!("{:08b}", b))
                .collect::<Vec<String>>();
        if last_bit_index != 0 {
            formatted_data[last_byte_index] =
                formatted_data[last_byte_index][..(last_bit_index + 1) as usize].to_string();
        }
        formatted_data.join(",")
    }

    pub(crate) fn bitmap_byte_index_and_bit_index(index: u64) -> (usize, u8) {
        let byte_index = index / BITS_PER_BYTE as u64;
        let bit_index = index % BITS_PER_BYTE as u64;
        let bit_index_u8 = bit_index as u8;
        assert!(BITS_PER_BYTE > bit_index_u8);
        (byte_index as usize, bit_index_u8)
    }

    fn verify_index(&self, index: u64) -> Result<()> {
        require_gt!(self.0, index, ErrorCode::BitmapIndexOutOfBonds);
        Ok(())
    }

    fn set_inner(&mut self, index: u64, bitmap_data: &mut [u8]) -> Result<()> {
        let (byte_index, bit_index) = Self::bitmap_byte_index_and_bit_index(index);
        let old_byte = self.bitmap_byte_mut(byte_index, bitmap_data);
        let new_byte = *old_byte | (1_u8 << (BITS_PER_BYTE - 1 - bit_index));
        *old_byte = new_byte;
        Ok(())
    }

    fn bitmap_byte<'a>(&self, byte_index: usize, bitmap_data: &'a [u8]) -> &'a u8 {
        &bitmap_data[byte_index]
    }

    fn bitmap_byte_mut<'a>(&mut self, byte_index: usize, bitmap_data: &'a mut [u8]) -> &'a mut u8 {
        &mut bitmap_data[byte_index]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bitmap_size_in_bytes() {
        assert_eq!(BitmapProjection::bitmap_size_in_bytes(0), 0);
        assert_eq!(BitmapProjection::bitmap_size_in_bytes(1), 1);
        assert_eq!(BitmapProjection::bitmap_size_in_bytes(7), 1);
        assert_eq!(BitmapProjection::bitmap_size_in_bytes(8), 1);
        assert_eq!(BitmapProjection::bitmap_size_in_bytes(9), 2);
        assert_eq!(BitmapProjection::bitmap_size_in_bytes(15), 2);
        assert_eq!(BitmapProjection::bitmap_size_in_bytes(16), 2);
        assert_eq!(BitmapProjection::bitmap_size_in_bytes(17), 3);
        assert_eq!(
            BitmapProjection::bitmap_size_in_bytes(u64::MAX),
            (u64::MAX / 8 + 1) as usize
        );
    }

    #[test]
    fn test_bitmap_projection() {
        let max_records = 1111;
        let mut bitmap_test_data = vec![0_u8; BitmapProjection::bitmap_size_in_bytes(max_records)];
        let mut bitmap = BitmapProjection(max_records);
        BitmapProjection::check_size(max_records, &bitmap_test_data).unwrap();

        assert_eq!(bitmap.number_of_bits(&bitmap_test_data).unwrap(), 0);

        let last_index = max_records - 1;
        for i in 0..last_index {
            assert!(!bitmap.is_set(i, &bitmap_test_data).unwrap());
            let (byte_index, bit_index) = BitmapProjection::bitmap_byte_index_and_bit_index(i);
            assert_eq!(bitmap_test_data[byte_index], set_bits(bit_index));

            assert!(bitmap.try_to_set(i, &mut bitmap_test_data).unwrap());
            assert!(bitmap.is_set(i, &bitmap_test_data).unwrap());
            assert!(!bitmap.try_to_set(i, &mut bitmap_test_data).unwrap());
            bitmap.set(i, &mut bitmap_test_data).unwrap();
            assert!(bitmap.is_set(i, &bitmap_test_data).unwrap());
            assert_eq!(bitmap.number_of_bits(&bitmap_test_data).unwrap(), i + 1);

            assert_eq!(bitmap_test_data[byte_index], set_bits(bit_index + 1));

            let mut debug_string = (0..=i).map(|_| "1").collect::<String>();
            debug_string.push_str(&(i..max_records).map(|_| "0").collect::<String>());
            // split string "debug_string" into 8 characters chunks (not 8 characters bytes)
            let debug_string_chunks = debug_string
                .chars()
                .collect::<Vec<char>>()
                .chunks(8)
                .map(|c| c.iter().collect::<String>())
                .collect::<Vec<String>>()
                .join(",");
            assert_eq!(bitmap.debug_string(&bitmap_test_data), debug_string_chunks);
        }

        assert!(!bitmap.is_set(last_index, &bitmap_test_data).unwrap());
        bitmap.set(last_index, &mut bitmap_test_data).unwrap();
        assert!(bitmap.is_set(last_index, &bitmap_test_data).unwrap());
        assert_eq!(
            bitmap.number_of_bits(&bitmap_test_data).unwrap(),
            max_records
        );
    }

    fn set_bits(number: u8) -> u8 {
        let mut result = 0;
        for i in 0..number {
            result |= 1 << (7 - i);
        }
        result
    }

    #[test]
    fn test_byte_index() {
        assert_eq!(BitmapProjection::bitmap_byte_index_and_bit_index(0), (0, 0));
        assert_eq!(BitmapProjection::bitmap_byte_index_and_bit_index(1), (0, 1));
        assert_eq!(BitmapProjection::bitmap_byte_index_and_bit_index(7), (0, 7));
        assert_eq!(BitmapProjection::bitmap_byte_index_and_bit_index(8), (1, 0));
        assert_eq!(BitmapProjection::bitmap_byte_index_and_bit_index(9), (1, 1));
        assert_eq!(
            BitmapProjection::bitmap_byte_index_and_bit_index(15),
            (1, 7)
        );
        assert_eq!(
            BitmapProjection::bitmap_byte_index_and_bit_index(16),
            (2, 0)
        );
        assert_eq!(
            BitmapProjection::bitmap_byte_index_and_bit_index(10240),
            (1280, 0)
        );
        assert_eq!(
            BitmapProjection::bitmap_byte_index_and_bit_index(10241),
            (1280, 1)
        );
    }
}
