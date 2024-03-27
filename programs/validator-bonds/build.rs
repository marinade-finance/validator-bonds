fn main() {
    // we require overflow checks for the program to function correctly
    match ::std::panic::catch_unwind(|| {
        #[allow(arithmetic_overflow)]
        let _ = 255_u8 + 1;
    }) {
        Ok(_) => {
            // `not(cfg(overflow_checks))`
            panic!("overflow checks are required for the program to function correctly");
        }
        Err(_) => {
            // `cfg(overflow_checks)`
            println!("cargo:rustc-cfg=overflow_checks");
        }
    }

    println!("cargo:rerun-if-env-changed=GIT_REV");
    println!(
        "cargo:rustc-env=GIT_REV={}",
        option_env!("GIT_REV").unwrap_or("GIT_REV_MISSING")
    );

    println!("cargo:rerun-if-env-changed=GIT_REV_NAME");
    println!(
        "cargo:rustc-env=GIT_REV_NAME={}",
        option_env!("GIT_REV_NAME").unwrap_or("GIT_REV_NAME_MISSING")
    );
}
