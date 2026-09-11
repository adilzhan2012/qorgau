/**
 * Short relative time in the style iOS uses for last-seen labels:
 * «только что», «2 мин назад», «3 ч назад», «вчера», «12 мар».
 */
export function formatRelativeTime(date: Date | null, now: number = Date.now()): string {
  if (!date) return "сигнала ещё не было";

  const seconds = Math.round((now - date.getTime()) / 1000);

  if (seconds < 45) return "только что";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} ${plural(minutes, "минуту", "минуты", "минут")} назад`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${plural(hours, "час", "часа", "часов")} назад`;

  const days = Math.round(hours / 24);
  if (days === 1) return "вчера";
  if (days < 7) return `${days} ${plural(days, "день", "дня", "дней")} назад`;

  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

/** Russian needs three plural forms, picked by the last digits of the count. */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/** «14:02:37» — the exact moment, for tooltips over relative times. */
export function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
