//! Passive Windows power constraints for native acrylic.

use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::AppHandle;

static APP: OnceLock<AppHandle> = OnceLock::new();
static LOW_BATTERY: AtomicBool = AtomicBool::new(false);
static LOW_POWER_MODE: AtomicBool = AtomicBool::new(false);
static READY: AtomicBool = AtomicBool::new(false);

fn update(constraint: &AtomicBool, active: bool) {
    if constraint.swap(active, Ordering::SeqCst) == active {
        return;
    }
    if READY.load(Ordering::SeqCst)
        && let Some(app) = APP.get()
    {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || crate::refresh_window_effects(&handle));
    }
}

#[cfg(windows)]
pub fn acrylic_available() -> bool {
    !LOW_BATTERY.load(Ordering::SeqCst) && !LOW_POWER_MODE.load(Ordering::SeqCst)
}

#[cfg(not(windows))]
pub fn acrylic_available() -> bool {
    false
}

#[cfg(windows)]
pub fn register(app: AppHandle) {
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::Power::{
        DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS, EFFECTIVE_POWER_MODE_V2,
        EffectivePowerModeBatterySaver, EffectivePowerModeBetterBattery, POWERBROADCAST_SETTING,
        PowerRegisterForEffectivePowerModeNotifications, PowerSettingRegisterNotification,
    };
    use windows_sys::Win32::System::SystemServices::GUID_BATTERY_PERCENTAGE_REMAINING;
    use windows_sys::Win32::UI::WindowsAndMessaging::DEVICE_NOTIFY_CALLBACK;

    unsafe extern "system" fn power_mode(mode: i32, _: *const core::ffi::c_void) {
        update(
            &LOW_POWER_MODE,
            mode == EffectivePowerModeBatterySaver || mode == EffectivePowerModeBetterBattery,
        );
    }

    unsafe extern "system" fn battery(
        _: *const core::ffi::c_void,
        _: u32,
        setting: *const core::ffi::c_void,
    ) -> u32 {
        let setting = unsafe { (setting as *const POWERBROADCAST_SETTING).as_ref() };
        if let Some(setting) = setting.filter(|value| value.DataLength >= 4) {
            let percentage = unsafe { (setting.Data.as_ptr() as *const u32).read_unaligned() };
            update(&LOW_BATTERY, percentage < 33);
        }
        0
    }

    let _ = APP.set(app);
    let mut handle = std::ptr::null_mut();
    unsafe {
        let _ = PowerRegisterForEffectivePowerModeNotifications(
            EFFECTIVE_POWER_MODE_V2,
            Some(power_mode),
            std::ptr::null(),
            &mut handle,
        );
        let subscription = Box::leak(Box::new(DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS {
            Callback: Some(battery),
            Context: std::ptr::null_mut(),
        }));
        let _ = PowerSettingRegisterNotification(
            &GUID_BATTERY_PERCENTAGE_REMAINING,
            DEVICE_NOTIFY_CALLBACK,
            subscription as *mut _ as HANDLE,
            &mut handle,
        );
    }
    READY.store(true, Ordering::SeqCst);
}

#[cfg(not(windows))]
pub fn register(_: AppHandle) {}
