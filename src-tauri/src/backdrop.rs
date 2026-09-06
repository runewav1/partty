//! Passive Windows power constraints for native acrylic.

use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::AppHandle;

static APP: OnceLock<AppHandle> = OnceLock::new();
static LOW_BATTERY: AtomicBool = AtomicBool::new(false);
static LOW_POWER_MODE: AtomicBool = AtomicBool::new(false);
static ON_BATTERY: AtomicBool = AtomicBool::new(false);
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
    !(ON_BATTERY.load(Ordering::SeqCst) && LOW_BATTERY.load(Ordering::SeqCst))
        && !LOW_POWER_MODE.load(Ordering::SeqCst)
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
        EffectivePowerModeBatterySaver, EffectivePowerModeBetterBattery,
        PDEVICE_NOTIFY_CALLBACK_ROUTINE, POWERBROADCAST_SETTING, PoAc,
        PowerRegisterForEffectivePowerModeNotifications, PowerSettingRegisterNotification,
    };
    use windows_sys::Win32::System::SystemServices::{
        GUID_ACDC_POWER_SOURCE, GUID_BATTERY_PERCENTAGE_REMAINING,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::DEVICE_NOTIFY_CALLBACK;

    unsafe fn setting_value(setting: *const core::ffi::c_void) -> Option<u32> {
        let setting = unsafe { (setting as *const POWERBROADCAST_SETTING).as_ref() }?;
        (setting.DataLength >= 4)
            .then(|| unsafe { (setting.Data.as_ptr() as *const u32).read_unaligned() })
    }

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
        if let Some(percentage) = unsafe { setting_value(setting) } {
            update(&LOW_BATTERY, percentage < 33);
        }
        0
    }

    unsafe extern "system" fn power_source(
        _: *const core::ffi::c_void,
        _: u32,
        setting: *const core::ffi::c_void,
    ) -> u32 {
        if let Some(source) = unsafe { setting_value(setting) } {
            update(&ON_BATTERY, source != PoAc as u32);
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
        let settings: [(&windows_sys::core::GUID, PDEVICE_NOTIFY_CALLBACK_ROUTINE); 2] = [
            (&GUID_BATTERY_PERCENTAGE_REMAINING, Some(battery)),
            (&GUID_ACDC_POWER_SOURCE, Some(power_source)),
        ];
        for (setting, callback) in settings {
            let subscription = Box::leak(Box::new(DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS {
                Callback: callback,
                Context: std::ptr::null_mut(),
            }));
            let _ = PowerSettingRegisterNotification(
                setting,
                DEVICE_NOTIFY_CALLBACK,
                subscription as *mut _ as HANDLE,
                &mut handle,
            );
        }
    }
    READY.store(true, Ordering::SeqCst);
}

#[cfg(not(windows))]
pub fn register(_: AppHandle) {}
