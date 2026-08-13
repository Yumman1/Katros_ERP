"use client";

import { ChangeRequestsInbox } from "@/components/team/change-requests-inbox";
import { canActOnDepartment, type Department } from "@/lib/departments";
import { useTeam } from "@/lib/use-team";

export function ApprovalsInbox({
  department,
  embedded = false,
}: {
  department: Department;
  embedded?: boolean;
}) {
  const { role, isHead } = useTeam();
  const isHeadHere = role != null && canActOnDepartment(role, isHead, department);

  return (
    <ChangeRequestsInbox
      department={department}
      embedded={embedded}
      title={isHeadHere ? "Team Approvals" : "My Approvals"}
      subtitle={
        isHeadHere
          ? "Review team requests — gate register edits, truck movements, warehouse changes, trade edits, and other actions requiring head approval."
          : "Track change requests you submitted for head of execution approval."
      }
    />
  );
}
