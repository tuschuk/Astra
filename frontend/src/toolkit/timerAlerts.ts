/**
 * The timer's one notification: "time's up", handed to the phone ahead of time so it arrives at
 * the right moment even when Astra is in the background, or closed altogether.
 *
 * Why it works without the app running: when a finite timer starts (or resumes), the timer store
 * already knows the exact clock time it will hit zero, so it asks the phone's own notification
 * system to show an alert at that time. The phone keeps the appointment; Astra's code doesn't have
 * to be awake for it. Pause or reset cancels the appointment. Everything is local to the phone —
 * no push service, no server, nothing sent anywhere — so it works with no signal.
 *
 * This is the only file that touches `expo-notifications`, and it loads it lazily and carefully: a
 * missing or broken notification module (as in some Expo Go builds, and always under Jest) turns
 * every call into a quiet "unavailable", and the timer keeps perfect time on screen regardless.
 * The timer never waits on anything here.
 */
import { Platform } from 'react-native';

type NotificationsModule = typeof import('expo-notifications');

/** What became of a request to schedule the end-of-timer alert. */
export type ScheduleOutcome =
  /** The phone has the appointment. */
  | 'scheduled'
  /** Notifications can't be used: permission refused, or no working notification module. */
  | 'unavailable'
  /** Nothing was scheduled because it no longer made sense — the moment had already passed, or
   *  the timer was paused/reset/restarted while permission was being asked. */
  | 'skipped';

/** The two things the timer store needs from notifications. Tests pass a fake. */
export interface TimerAlertsPort {
  /** Books the single "time's up" alert for the clock time `atMs`, replacing any already booked. */
  schedule(atMs: number, title: string, body: string): Promise<ScheduleOutcome>;
  /** Cancels the booked alert, if there is one. Safe to call when nothing is booked. */
  cancel(): Promise<void>;
}

/** The Android notification channel the timer's alerts go on (Android drops alerts without one). */
export const TIMER_CHANNEL_ID = 'timer';

/**
 * The fixed name the timer's alert is booked under. One name for the one alert means booking a
 * new one replaces the old, and cancelling works even for an alert booked before the app was
 * closed and reopened (when this code no longer remembers anything about it).
 */
export const TIMER_ALERT_ID = 'astra-timer-zero';

/**
 * Loads `expo-notifications` on first use, or returns null if it can't be loaded. Kept out of the
 * file's imports on purpose: an import that crashes would take the whole Tool Kit down with it.
 */
export function loadNotificationsModule(): NotificationsModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded lazily and guarded so a broken native module can't crash the Tool Kit
    return require('expo-notifications') as NotificationsModule;
  } catch (caught) {
    console.warn('Timer: notifications are unavailable on this build', caught);
    return null;
  }
}

interface TimerAlertsOptions {
  /** Supplies the notifications module, or null when there isn't a usable one. */
  load: () => NotificationsModule | null;
  /** 'android' sets up the notification channel first; other platforms don't need one. */
  platform: string;
  /** The current clock time (ms); injectable for tests. */
  now: () => number;
}

/**
 * Builds the alerts port over a notifications module. The one subtle rule it enforces: only the
 * latest request counts. Asking permission can take as long as the lifter takes to answer the
 * dialog, and they may pause or reset in the meantime — so every schedule or cancel bumps a
 * counter, and a schedule that finds the counter moved on while it waited books nothing. Every
 * booking uses the same name (`TIMER_ALERT_ID`), so a new booking replaces the old one and a
 * cancel always reaches it.
 */
export function createTimerAlerts({ load, platform, now }: TimerAlertsOptions): TimerAlertsPort {
  let loaded: NotificationsModule | null | undefined;
  let channelReady = false;
  let requestCount = 0;

  const notifications = (): NotificationsModule | null => {
    if (loaded === undefined) loaded = load();
    return loaded;
  };

  /** Withdraws the booked alert, tolerating one that has already fired or never existed. */
  async function withdraw(module: NotificationsModule): Promise<void> {
    try {
      await module.cancelScheduledNotificationAsync(TIMER_ALERT_ID);
    } catch (caught) {
      console.warn('Timer: could not cancel the alert', caught);
    }
  }

  /** True if notifications may be shown, asking the lifter the first time. */
  async function permitted(module: NotificationsModule): Promise<boolean> {
    const current = await module.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const asked = await module.requestPermissionsAsync();
    return asked.granted;
  }

  return {
    async schedule(atMs, title, body) {
      const thisRequest = ++requestCount;
      const module = notifications();
      if (module === null) return 'unavailable';
      try {
        await withdraw(module);
        if (platform === 'android' && !channelReady) {
          await module.setNotificationChannelAsync(TIMER_CHANNEL_ID, {
            name: 'Timer',
            importance: module.AndroidImportance.HIGH,
          });
          channelReady = true;
        }
        if (!(await permitted(module))) return 'unavailable';
        // The lifter took longer to answer than the timer ran, or changed the timer meanwhile.
        if (thisRequest !== requestCount || atMs <= now()) return 'skipped';
        await module.scheduleNotificationAsync({
          identifier: TIMER_ALERT_ID,
          content: { title, body, sound: true },
          trigger: { type: module.SchedulableTriggerInputTypes.DATE, date: atMs, channelId: TIMER_CHANNEL_ID },
        });
        // Cancelled or replaced while the booking was being made: the later cancel / booking was
        // handed to the phone after this one, under the same name, so it already wins. (Taking this
        // one back here could withdraw the replacement instead.)
        return thisRequest === requestCount ? 'scheduled' : 'skipped';
      } catch (caught) {
        console.warn('Timer: could not schedule the alert', caught);
        return 'unavailable';
      }
    },

    async cancel() {
      requestCount++;
      const module = notifications();
      if (module === null) return;
      await withdraw(module);
    },
  };
}

/** The app's alerts port, over the real `expo-notifications`. */
export const timerAlerts: TimerAlertsPort = createTimerAlerts({
  load: loadNotificationsModule,
  platform: Platform.OS,
  now: () => Date.now(),
});
