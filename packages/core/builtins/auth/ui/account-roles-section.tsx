import { Badge } from '@agentos/ui/components/badge';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from '@agentos/ui/components/field';

export type AccountRolesSectionProps = {
  roles: string[];
};

export function AccountRolesSection({ roles }: AccountRolesSectionProps) {
  return (
    <FieldSet data-slot="account-roles" data-setting-entry="roles">
      <FieldLegend>Roles</FieldLegend>
      <FieldDescription>
        Access roles granted to your account in this workspace.
      </FieldDescription>
      <FieldGroup>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldTitle>Assigned roles</FieldTitle>
            <FieldDescription>Assigned via Auth RBAC.</FieldDescription>
          </FieldContent>
          {roles.length > 0 ? (
            <div className="flex flex-wrap justify-end gap-1.5">
              {roles.map((role) => (
                <Badge key={role} variant="secondary">
                  {role}
                </Badge>
              ))}
            </div>
          ) : (
            <FieldDescription>No roles assigned</FieldDescription>
          )}
        </Field>
      </FieldGroup>
    </FieldSet>
  );
}
