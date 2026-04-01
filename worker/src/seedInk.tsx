import React, { useState } from "react";
import { Box, Newline, Text, render, useInput } from "ink";
import type { RegisteredWrappedApp } from "./templates";

export class SeedPromptCancelledError extends Error {
  constructor() {
    super("Seed prompt cancelled");
    this.name = "SeedPromptCancelledError";
  }
}

type PromptController<T> = {
  reject: (error: Error) => void;
  resolve: (value: T) => void;
};

type SeedTargetChoice =
  | {
      kind: "all";
      appIds: string[];
      description: string;
      label: string;
    }
  | {
      kind: "app";
      appIds: [string];
      description: string;
      label: string;
    };

type ConfirmChoice = {
  label: string;
  value: boolean;
};

function renderPrompt<T>(
  createNode: (controller: PromptController<T>) => React.JSX.Element,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let instance: ReturnType<typeof render> | null = null;

    const finish = (callback: (value: T) => void | ((error: Error) => void), value: T | Error) => {
      if (settled) {
        return;
      }
      settled = true;
      callback(value as never);
      instance?.unmount();
    };

    instance = render(
      createNode({
        resolve: (value) => finish(resolve, value),
        reject: (error) => finish(reject, error),
      }),
      {
        exitOnCtrlC: false,
      },
    );

    void instance.waitUntilExit().catch((error) => {
      if (!settled) {
        reject(error);
      }
    });
  });
}

function SelectList(props: {
  choices: Array<{ description: string; label: string }>;
  footer: string;
  title: string;
  onCancel: () => void;
  onSelect: (index: number) => void;
}) {
  const [index, setIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow || input === "k") {
      setIndex((current) =>
        current === 0 ? props.choices.length - 1 : current - 1,
      );
      return;
    }

    if (key.downArrow || input === "j") {
      setIndex((current) =>
        current === props.choices.length - 1 ? 0 : current + 1,
      );
      return;
    }

    if (key.return) {
      props.onSelect(index);
      return;
    }

    if (key.escape || (key.ctrl && input === "c")) {
      props.onCancel();
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>{props.title}</Text>
      <Newline />
      {props.choices.map((choice, choiceIndex) => {
        const selected = choiceIndex === index;
        return (
          <Box key={`${choice.label}-${choiceIndex}`} flexDirection="column" marginBottom={1}>
            <Text color={selected ? "cyan" : undefined}>
              {selected ? "›" : " "} {choice.label}
            </Text>
            <Text dimColor>{choice.description}</Text>
          </Box>
        );
      })}
      <Text dimColor>{props.footer}</Text>
    </Box>
  );
}

function SeedTargetPicker(props: {
  apps: RegisteredWrappedApp[];
  controller: PromptController<string[]>;
}) {
  const choices: SeedTargetChoice[] = [
    {
      kind: "all",
      appIds: props.apps.map((app) => app.appId),
      description: `${props.apps.length} wrapped app(s)`,
      label: "Seed all wrapped apps",
    },
    ...props.apps.map((app) => ({
      kind: "app" as const,
      appIds: [app.appId] as [string],
      description: app.relativeRoot,
      label: `${app.label} (${app.appId})`,
    })),
  ];

  return (
    <SelectList
      choices={choices}
      footer="↑/↓ move • Enter select • Esc cancel"
      title="Select a wrapped app to seed"
      onCancel={() => props.controller.reject(new SeedPromptCancelledError())}
      onSelect={(index) => props.controller.resolve(choices[index]!.appIds)}
    />
  );
}

function ConfirmResetPrompt(props: {
  appId: string;
  details: string[];
  controller: PromptController<boolean>;
}) {
  const choices: ConfirmChoice[] = [
    {
      label: "Yes, clear stale state and reseed",
      value: true,
    },
    {
      label: "No, cancel",
      value: false,
    },
  ];

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>[seed] found stale state for '{props.appId}'</Text>
      <Newline />
      {props.details.map((detail) => (
        <Text key={detail}>- {detail}</Text>
      ))}
      <Newline />
      <SelectList
        choices={choices.map((choice) => ({
          label: choice.label,
          description:
            choice.value
              ? "Removes old jobs, versions, pipeline history, and queued purge state."
              : "Leaves existing state untouched and stops this seed run.",
        }))}
        footer="↑/↓ move • Enter confirm • Esc cancel"
        title={`Choose how to handle '${props.appId}'`}
        onCancel={() => props.controller.resolve(false)}
        onSelect={(index) => props.controller.resolve(choices[index]!.value)}
      />
    </Box>
  );
}

export async function chooseSeedTargetsWithInk(
  apps: RegisteredWrappedApp[],
): Promise<string[]> {
  return await renderPrompt((controller) => (
    <SeedTargetPicker apps={apps} controller={controller} />
  ));
}

export async function confirmResetWithInk(args: {
  appId: string;
  details: string[];
}): Promise<boolean> {
  return await renderPrompt((controller) => (
    <ConfirmResetPrompt
      appId={args.appId}
      controller={controller}
      details={args.details}
    />
  ));
}
