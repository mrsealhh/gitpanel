//! 统一创建子进程。
//!
//! Windows 上 GUI 程序（`windows_subsystem = "windows"`）派生控制台子进程时，
//! 默认会闪出一个 cmd 黑窗口；git 这类命令每次操作都会调用，体验很差。
//! 这里统一加 `CREATE_NO_WINDOW`，让所有外部命令都静默运行。

use std::process::Command;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 创建一个不弹控制台窗口的命令
pub fn command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut c = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}
