fn main() {
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
