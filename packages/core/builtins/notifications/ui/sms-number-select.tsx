import type { IntegrationSettingRenderInput } from '@agentos/core/client/components/integration-section';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@agentos/ui/components/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@agentos/ui/components/select';

import {
  smsNumberLabel,
  type SmsNumber,
  type SmsNumbersState,
} from './use-sms-numbers';

const NONE = '__none__';

/**
 * Dropdown over the Twilio account's SMS-capable numbers. A saved value that is
 * no longer on the account stays selectable so it is visible, not silently lost.
 */
export function SmsNumberSelect({
  id,
  value,
  numbers,
  noneLabel,
  placeholder,
  disabled,
  invalid,
  onValueChange,
}: {
  id?: string;
  value: string;
  numbers: SmsNumber[];
  noneLabel: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  onValueChange: (value: string) => void;
}) {
  const known = numbers.some((n) => n.phoneNumber === value);
  const options: SmsNumber[] =
    value && !known
      ? [{ phoneNumber: value, friendlyName: value }, ...numbers]
      : numbers;
  const items = [
    { value: NONE, label: noneLabel },
    ...options.map((n) => ({
      value: n.phoneNumber,
      label:
        value === n.phoneNumber && !known
          ? `${n.phoneNumber} (not on this account)`
          : smsNumberLabel(n),
    })),
  ];
  return (
    <Select
      items={items}
      value={value || NONE}
      disabled={disabled}
      onValueChange={(next) => {
        if (typeof next === 'string') onValueChange(next === NONE ? '' : next);
      }}
    >
      <SelectTrigger
        id={id}
        className="w-full sm:max-w-60"
        aria-invalid={invalid || undefined}
      >
        <SelectValue placeholder={placeholder ?? 'Choose a number'} />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Why the dropdown has no options (nothing connected, rejected key, no numbers). */
export function smsNumbersHint(
  state: {
    loading: boolean;
    configured: boolean;
    numbers: SmsNumber[];
    error: string | null;
  },
  audience: 'admin' | 'member',
): string | null {
  if (state.loading) return 'Loading numbers from Twilio…';
  if (state.error) return null;
  if (!state.configured) {
    return audience === 'admin'
      ? 'No Twilio account is connected yet. Save your API key to load its numbers.'
      : 'No Twilio account is connected yet. Ask an admin to add an API key in Settings → SMS.';
  }
  if (state.numbers.length === 0) {
    return 'No SMS-capable numbers were found on the Twilio account.';
  }
  return null;
}

/** Admin "Default from number" control rendered inside the Twilio card. */
export function SmsDefaultNumberField({
  input,
  state,
}: {
  input: IntegrationSettingRenderInput;
  state: SmsNumbersState;
}) {
  const { id, field, value, onValueChange, disabled, errors } = input;
  const invalid = Boolean(errors?.length);
  const hint = smsNumbersHint(state, 'admin');
  return (
    <Field
      orientation="responsive"
      data-slot="integration-setting"
      data-invalid={invalid || undefined}
    >
      <FieldContent>
        <FieldLabel htmlFor={id}>
          {field.label}
          <span className="text-muted-foreground"> (optional)</span>
        </FieldLabel>
        {field.description ? (
          <FieldDescription>{field.description}</FieldDescription>
        ) : null}
        {invalid ? <FieldError errors={errors} /> : null}
        {state.error ? <FieldError>{state.error}</FieldError> : null}
        {hint ? <FieldDescription>{hint}</FieldDescription> : null}
      </FieldContent>
      <SmsNumberSelect
        id={id}
        value={value}
        numbers={state.numbers}
        noneLabel="No default"
        placeholder="No default"
        disabled={disabled || state.loading}
        invalid={invalid}
        onValueChange={onValueChange}
      />
    </Field>
  );
}
