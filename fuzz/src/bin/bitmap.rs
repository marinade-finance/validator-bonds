use honggfuzz::fuzz;

/// see https://github.com/rust-fuzz/honggfuzz-rs/tree/master
fn main() {
    loop {
        fuzz!(|_data: &[u8]| {
            // Bit
        });
    }
}
