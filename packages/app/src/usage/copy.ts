import type { TFunction } from "i18next";
import type { UsageProblem } from "@getpaseo/protocol/messages";
import { i18n } from "@/i18n/i18next";
import { formatAgo } from "./format";

// Messages for usage failures outside the UI. Rendered copy uses useTranslation.
export const usageCopy = {
  problem: (problem: UsageProblem, now: Date = new Date(), t: TFunction = i18n.t): string => {
    if (problem.kind === "no_quota") return problem.detail;
    const remedy = problem.refreshedBy
      ? t("providerUsage.runToRefresh", { command: problem.refreshedBy })
      : t("providerUsage.signInAgain");
    if (problem.kind === "rejected")
      return t("providerUsage.loginRejected", { status: problem.status, remedy });
    const relativeTime = formatAgo(problem.expiresAt, now.getTime(), t);
    // Agents do not depend on this login being fresh: idle logins expire, and Paseoi falls back
    // to the stored setup-token when the CLI cannot refresh it.
    if (problem.refreshedBy === "claude")
      return t("providerUsage.claudeLoginExpired", { relativeTime });
    return t("providerUsage.loginExpired", { relativeTime, remedy });
  },
  get clientUnavailable() {
    return i18n.t("providerUsage.clientUnavailable");
  },
} as const;
