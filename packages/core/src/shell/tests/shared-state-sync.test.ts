import { beforeEach, describe, expect, test } from 'bun:test';
import {
  connectHostSharedState,
  createHostEventDispatcher,
} from '@agentos/core/client';
import {
  createShellEventBus,
  createShellHostApi,
  resetShellHostApiStorage,
  type EventDeclarations,
  type ShellEventBus,
} from '@agentos/core/shell/lib';

const TOPIC = 'files.selection.changed';
const KEY = 'files:selection';

const DECLARATIONS: Record<string, EventDeclarations> = {
  files: { publishes: [TOPIC], subscribes: [TOPIC] },
  'inbound-email': {
    publishes: ['inbound-email.section.changed'],
    subscribes: ['inbound-email.section.changed'],
  },
};

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** One iframe: its own client dispatcher, wired to the shared Shell bus. */
function makeFrame(bus: ShellEventBus, extensionId: string, frameId: string) {
  const dispatcher = createHostEventDispatcher();
  bus.attachFrame(frameId, extensionId, (topic, payload) =>
    dispatcher.dispatch(topic, payload),
  );
  const host = createShellHostApi(extensionId, { frameId, eventBus: bus });
  return { host, dispatcher };
}

function connect(
  frame: ReturnType<typeof makeFrame>,
  options: { topic?: string; key?: string } = {},
) {
  const values: string[][] = [];
  const state = connectHostSharedState<string[]>(
    frame.host,
    options.key ?? KEY,
    [],
    {
      topic: options.topic ?? TOPIC,
      parse: (raw) => (Array.isArray(raw) ? (raw as string[]) : []),
    },
    (value) => values.push(value),
    frame.dispatcher,
  );
  return { state, values, last: () => values.at(-1) };
}

describe('shared state across frames (BroadcastChannel replacement)', () => {
  beforeEach(() => resetShellHostApiStorage());

  test('an update in the page reaches the right sidebar live', async () => {
    const bus = createShellEventBus((id) => DECLARATIONS[id]);
    const page = connect(makeFrame(bus, 'files', 'files:page:1'));
    const sidebar = connect(makeFrame(bus, 'files', 'files:right-sidebar:2'));
    await flush();

    await page.state.update(['a', 'b']);

    expect(sidebar.last()).toEqual(['a', 'b']);
    expect(page.last()).toEqual(['a', 'b']);
    // The page applied its own value once (optimistic), not again from an echo.
    expect(page.values.filter((v) => v.length === 2)).toHaveLength(2);

    await sidebar.state.update(['c']);
    expect(page.last()).toEqual(['c']);
  });

  test('a frame mounted later loads the persisted value', async () => {
    const bus = createShellEventBus((id) => DECLARATIONS[id]);
    const page = connect(makeFrame(bus, 'files', 'files:page:1'));
    await flush();
    await page.state.update(['x']);

    const late = connect(makeFrame(bus, 'files', 'files:right-sidebar:2'));
    await flush();
    expect(late.last()).toEqual(['x']);
  });

  test('hook instances in the same frame stay in sync without the Shell', async () => {
    const bus = createShellEventBus((id) => DECLARATIONS[id]);
    const frame = makeFrame(bus, 'files', 'files:page:1');
    const one = connect(frame);
    const two = connect(frame);
    await flush();

    await one.state.update(['same-frame']);
    expect(two.last()).toEqual(['same-frame']);
  });

  test('another extension neither sees nor can join the topic', async () => {
    const bus = createShellEventBus((id) => DECLARATIONS[id]);
    const files = connect(makeFrame(bus, 'files', 'files:page:1'));
    const email = connect(makeFrame(bus, 'inbound-email', 'email:page:1'));
    const originalError = console.error;
    const logged: unknown[][] = [];
    console.error = (...args: unknown[]) => logged.push(args);
    // inbound-email never declared files.selection.changed.
    const intruder = connect(makeFrame(bus, 'inbound-email', 'email:side:2'), {
      topic: TOPIC,
    });
    await flush();
    console.error = originalError;

    await files.state.update(['secret']);

    expect(String(logged[0]?.[0])).toContain(TOPIC);
    expect(intruder.last()).toEqual([]);
    expect(email.last()).toEqual([]);
  });

  test('stop() ends delivery and drops the Shell subscription', async () => {
    const bus = createShellEventBus((id) => DECLARATIONS[id]);
    const page = connect(makeFrame(bus, 'files', 'files:page:1'));
    const sidebar = connect(makeFrame(bus, 'files', 'files:right-sidebar:2'));
    await flush();
    expect(bus.active).toBe(true);

    sidebar.state.stop();
    await flush();
    await page.state.update(['after-stop']);

    expect(sidebar.last()).toEqual([]);
    page.state.stop();
    await flush();
    expect(bus.active).toBe(false);
  });

  test('separate topics do not cross-talk', async () => {
    const decl: Record<string, EventDeclarations> = {
      files: {
        publishes: [TOPIC, 'files.prefix.changed'],
        subscribes: [TOPIC, 'files.prefix.changed'],
      },
    };
    const bus = createShellEventBus((id) => decl[id]);
    const page = makeFrame(bus, 'files', 'files:page:1');
    const side = makeFrame(bus, 'files', 'files:side:2');
    const pagePrefix = connect(page, {
      topic: 'files.prefix.changed',
      key: 'files:prefix',
    });
    const sideSel = connect(side);
    const sidePrefix = connect(side, {
      topic: 'files.prefix.changed',
      key: 'files:prefix',
    });
    await flush();

    await pagePrefix.state.update(['/docs']);
    expect(sidePrefix.last()).toEqual(['/docs']);
    expect(sideSel.last()).toEqual([]);
  });
});
