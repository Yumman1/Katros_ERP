"use client";

import { ChangeRequestsInbox } from "@/components/team/change-requests-inbox";

export default function ExecutionTeamApprovalsPage() {
  return (
    <ChangeRequestsInbox department="EXECUTION" embedded showTeamQueue showMine={false} />
  );
}
