import type { MailMessage, RuleItem } from "../types";

function normalize(value: string | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase("pt-BR");
}

function fieldValue(message: MailMessage, field: RuleItem["field"]): string {
  if (field === "from") {
    return `${message.from.name ?? ""} ${message.from.email}`;
  }

  if (field === "to") {
    return message.to.map((recipient) => `${recipient.name ?? ""} ${recipient.email}`).join(" ");
  }

  if (field === "subject") return message.subject;
  if (field === "body") return `${message.bodyText ?? ""} ${message.preview}`;

  const domain = message.from.email.split("@")[1] ?? "";
  return domain;
}

export function ruleMatchesMessage(rule: RuleItem, message: MailMessage): boolean {
  if (!rule.enabled || !rule.value.trim()) return false;

  const actual = normalize(fieldValue(message, rule.field));
  const expected = normalize(rule.value);

  if (rule.operator === "equals") {
    return actual === expected;
  }

  return actual.includes(expected);
}

export function pendingRulesForMessage(rules: RuleItem[], message: MailMessage): RuleItem[] {
  const applied = new Set(message.appliedRuleIds ?? []);

  return rules
    .filter((rule) => rule.enabled && !applied.has(rule.id) && ruleMatchesMessage(rule, message))
    .sort((a, b) => a.priority - b.priority);
}
