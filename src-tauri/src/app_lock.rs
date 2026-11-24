use crate::credentials;
use std::{sync::Mutex, time::{Duration, Instant}};

struct LockState {
    unlocked: bool,
    pin_observed: bool,
    last_activity: Option<Instant>,
    idle_minutes: u64,
    failures: u32,
    retry_loaded: bool,
    retry_after: Option<Instant>,
}

static STATE: Mutex<LockState> = Mutex::new(LockState {
    unlocked: false,
    pin_observed: false,
    last_activity: None,
    idle_minutes: 5,
    failures: 0,
    retry_loaded: false,
    retry_after: None,
});

fn state() -> Result<std::sync::MutexGuard<'static, LockState>, String> {
    STATE.lock().map_err(|_| "Bloqueio nativo indisponível.".to_string())
}

fn expire(s: &mut LockState) {
    if s.idle_minutes > 0 && s.last_activity.map(|time| time.elapsed() >= Duration::from_secs(s.idle_minutes * 60)).unwrap_or(true) {
        s.unlocked = false;
    }
}

// Do not silently disable a configured PIN if the cofre entry disappears
// during this process. Explicit, authenticated disable is the only reset.
fn observe_pin(s: &mut LockState, exists: bool) -> Result<bool, String> {
    if s.pin_observed && !exists {
        s.unlocked = false;
        s.last_activity = None;
        return Err("Registro do PIN desapareceu do cofre. Restaure o registro original.".into());
    }
    s.pin_observed |= exists;
    Ok(exists)
}

fn configured_locked(s: &mut LockState) -> Result<bool, String> {
    observe_pin(s, credentials::has_app_lock()?)
}

pub fn configured() -> Result<bool, String> {
    let mut s = state()?;
    configured_locked(&mut s)
}

pub fn is_locked() -> Result<bool, String> {
    let mut s = state()?;
    if !configured_locked(&mut s)? { return Ok(false); }
    expire(&mut s);
    Ok(!s.unlocked)
}

pub fn require_unlocked() -> Result<(), String> {
    if is_locked()? { return Err("Seven Mail bloqueado. Desbloqueie com o PIN.".into()); }
    Ok(())
}

// Reserved keyring scope; no retry state is accepted from the webview.
const RETRY_SCOPE: &str = "app-lock-retry";
const RETRY_ID: &str = "native";

fn restore_retry(s: &mut LockState, failures: u32) {
    s.failures = failures;
    let seconds = retry_delay(failures);
    // Reapply the full bounded delay on restart instead of trusting wall-clock time.
    s.retry_after = (seconds > 0).then(|| Instant::now() + Duration::from_secs(seconds));
    s.retry_loaded = true;
}

fn load_retry(s: &mut LockState) -> Result<(), String> {
    if s.retry_loaded { return Ok(()); }
    let failures = match credentials::load_scoped(RETRY_SCOPE, RETRY_ID)? {
        Some(value) => value.parse::<u32>().map_err(|_| "Estado de tentativas do PIN inválido.".to_string())?,
        None => 0,
    };
    restore_retry(s, failures);
    Ok(())
}

fn persist_retry(s: &mut LockState, failures: u32) -> Result<(), String> {
    credentials::store_scoped(RETRY_SCOPE, RETRY_ID, &failures.to_string())?;
    restore_retry(s, failures);
    Ok(())
}

fn check_pin(s: &mut LockState, pin: &str) -> Result<bool, String> {
    load_retry(s)?;
    if s.retry_after.map(|until| Instant::now() < until).unwrap_or(false) {
        return Err("Muitas tentativas. Aguarde antes de tentar novamente.".into());
    }
    // Record the attempt before checking the PIN; interruption cannot erase a failure.
    let failures = s.failures.saturating_add(1);
    persist_retry(s, failures)?;
    if pin.len() <= 64 && credentials::verify_app_lock(pin)? {
        persist_retry(s, 0)?;
        return Ok(true);
    }
    Ok(false)
}

fn retry_delay(failures: u32) -> u64 {
    if failures < 5 { 0 } else { 5u64 * (1u64 << (failures - 5).min(6)) }
}

pub fn unlock(pin: &str) -> Result<bool, String> {
    let mut s = state()?;
    if configured_locked(&mut s)? && !check_pin(&mut s, pin)? { return Ok(false); }
    s.unlocked = true;
    s.last_activity = Some(Instant::now());
    Ok(true)
}

pub fn lock() -> Result<(), String> {
    let mut s = state()?;
    s.unlocked = false;
    s.last_activity = None;
    Ok(())
}

pub fn activity(minutes: Option<u64>) -> Result<bool, String> {
    let mut s = state()?;
    if !configured_locked(&mut s)? { return Ok(true); }
    expire(&mut s);
    if !s.unlocked { return Ok(false); }
    if let Some(minutes) = minutes {
        if ![0, 1, 5, 15, 30].contains(&minutes) { return Err("Tempo de bloqueio inválido.".into()); }
        s.idle_minutes = minutes;
    }
    s.last_activity = Some(Instant::now());
    Ok(true)
}

pub fn configure(pin: &str, current_pin: Option<&str>) -> Result<(), String> {
    let mut s = state()?;
    if configured_locked(&mut s)? {
        expire(&mut s);
        if !s.unlocked || !check_pin(&mut s, current_pin.unwrap_or(""))? {
            return Err("Confirme o PIN atual para alterar o bloqueio.".into());
        }
    }
    persist_retry(&mut s, 0)?;
    credentials::set_app_lock(pin)?;
    s.pin_observed = true;
    s.unlocked = true;
    s.last_activity = Some(Instant::now());
    Ok(())
}

pub fn disable(pin: &str) -> Result<(), String> {
    let mut s = state()?;
    expire(&mut s);
    if configured_locked(&mut s)? && (!s.unlocked || !check_pin(&mut s, pin)?) {
        return Err("Confirme o PIN atual para desativar o bloqueio.".into());
    }
    credentials::clear_app_lock()?;
    s.pin_observed = false;
    s.unlocked = false;
    s.last_activity = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn disappearing_pin_revokes_existing_session() {
        let mut s = LockState { unlocked: true, pin_observed: false, last_activity: Some(Instant::now()), idle_minutes: 5, failures: 0, retry_loaded: false, retry_after: None };
        assert!(observe_pin(&mut s, true).unwrap());
        assert!(observe_pin(&mut s, false).is_err());
        assert!(!s.unlocked);
        assert!(s.last_activity.is_none());
        assert!(observe_pin(&mut s, false).is_err());
        assert!(observe_pin(&mut s, true).unwrap());
        assert!(!s.unlocked);
    }

    #[test]
    fn repeated_attempts_increase_wait_with_bounded_delay() {
        assert_eq!(retry_delay(4), 0);
        assert_eq!(retry_delay(5), 5);
        assert_eq!(retry_delay(6), 10);
        assert_eq!(retry_delay(u32::MAX), 320);
    }
    #[test]
    fn restored_failures_reapply_delay_without_wall_clock() {
        let mut s = LockState { unlocked: false, pin_observed: false, last_activity: None, idle_minutes: 5, failures: 0, retry_loaded: false, retry_after: None };
        restore_retry(&mut s, 6);
        assert!(s.retry_loaded);
        assert_eq!(s.failures, 6);
        assert!(s.retry_after.unwrap() > Instant::now());
        restore_retry(&mut s, 0);
        assert!(s.retry_after.is_none());
        assert_eq!(s.failures, 0);
    }

    #[test]
    fn expiration_revokes_access() {
        let mut s = LockState { unlocked: true, pin_observed: true, last_activity: Some(Instant::now() - Duration::from_secs(61)), idle_minutes: 1, failures: 0, retry_loaded: false, retry_after: None };
        expire(&mut s);
        assert!(!s.unlocked);
    }
}
