import { Button } from '@agentos/ui/components/button';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from '@agentos/ui/components/field';

export type AccountSessionSectionProps = {
  busy?: boolean;
  onSignOut: () => void | Promise<void>;
};

export function AccountSessionSection({
  busy = false,
  onSignOut,
}: AccountSessionSectionProps) {
  return (
    <FieldSet data-slot="account-session">
      <FieldLegend>Session</FieldLegend>
      <FieldDescription>
        Manage your active authentication session.
      </FieldDescription>
      <FieldGroup>
        <Field orientation="horizontal" data-setting-entry="log-out">
          <FieldContent>
            <FieldTitle>Log Out</FieldTitle>
            <FieldDescription>
              Sign out of this workspace on this device.
            </FieldDescription>
          </FieldContent>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void onSignOut()}
          >
            Log Out
          </Button>
        </Field>
      </FieldGroup>
    </FieldSet>
  );
}
