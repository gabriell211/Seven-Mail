import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { CalendarEvent, MailMessage, TaskItem } from "../types";

export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === "granted";
  } catch {
    return false;
  }
}

export async function notifyNewMessages(messages: MailMessage[]): Promise<void> {
  if (messages.length === 0) return;
  if (!(await ensureNotificationPermission())) return;

  const visible = messages.filter((message) => !message.isRead).slice(0, 3);
  for (const message of visible) {
    const sender = message.from.name?.trim() || message.from.email;
    sendNotification({
      title: sender || "Nova mensagem",
      body: message.subject.trim() || "(sem assunto)",
    });
  }

  if (messages.length > visible.length) {
    sendNotification({
      title: "Seven Mail",
      body: `+${messages.length - visible.length} nova(s) mensagem(ns)`,
    });
  }
}


export async function notifyTaskReminder(task: TaskItem): Promise<void> {
  if (!(await ensureNotificationPermission())) return;

  const due = task.dueAt
    ? new Date(task.dueAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
    : null;

  sendNotification({
    title: "Lembrete de tarefa",
    body: due ? `${task.title} · vence ${due}` : task.title,
  });
}


export async function notifyCalendarReminder(event: CalendarEvent): Promise<void> {
  if (!(await ensureNotificationPermission())) return;

  const starts = new Date(event.startAt).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });

  sendNotification({
    title: "Lembrete de evento",
    body: `${event.title} · ${starts}`,
  });
}
