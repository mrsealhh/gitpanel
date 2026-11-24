fn main() {
    // libgit2-sys 0.17 在 Windows 上没有显式声明这些系统库，而新版 rustc 不再默认
    // 链接 advapi32，导致 LNK2019（OpenProcessToken / RegOpenKeyExW / CryptAcquireContext 等）。
    // 在这里补齐，避免为了一个链接问题去追上游版本。
    let os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if os == "windows" {
        for lib in [
            "advapi32", "userenv", "ole32", "crypt32",
            "secur32", "ws2_32", "rpcrt4", "winhttp",
            "ntdll", "bcrypt",
        ] {
            println!("cargo:rustc-link-lib={lib}");
        }
    }
}
