type ControlFlowStepsEntry = {
  nextEvent?: string;
  [key: string]: any;
};

type ControlFlowSteps<T> = {
  entry?: (arg: T) => Promise<ControlFlowStepsEntry>;
  final?: boolean;
  [key: string]: any;
};

type ControlFlowArgs<T> = {
  initialStep: string;
  steps: {
    [key: string]: ControlFlowSteps<T>;
  };
  stepContext: T;
  logSteps: boolean;
};

type ControlFlowReturn = {
  step: string;
  data?: any;
  event?: string;
};

async function* createControlFlow<T>({
  initialStep,
  steps,
  stepContext,
  logSteps = false,
}: ControlFlowArgs<T>): AsyncGenerator<ControlFlowReturn> {
  let currentStep = initialStep;
  let currentConfig = steps[currentStep];
  while (true) {
    if (!currentConfig) {
      throw new Error(`Could not find config for ${currentStep}`);
    }
    if (currentConfig.final) {
      return;
    }
    if (!currentConfig.entry) {
      throw new Error(
        `Entered step ${currentStep} which is not a final step but does not have an entry action`
      );
    }
    let data: ControlFlowStepsEntry;
    let nextEvent: string;
    try {
      data = await currentConfig.entry(stepContext);
      nextEvent = "onDone";
    } catch (error) {
      data = error;
      nextEvent = "onError";
    }
    if (data?.nextEvent) {
      nextEvent = data.nextEvent;
      delete data.nextEvent;
    }
    let next = { step: currentConfig[nextEvent], data, event: nextEvent };
    if (logSteps) {
      // Helpful for debugging
      console.log({ currentStep, next });
    }
    currentStep = next.step;
    currentConfig = steps[currentStep];
    yield next;
  }
}

export default async function controlFlow<T>({
  initialStep,
  steps,
  stepContext,
  logSteps,
}: ControlFlowArgs<T>): Promise<ControlFlowReturn> {
  const controlFlowInstance = createControlFlow<T>({
    initialStep,
    steps,
    stepContext,
    logSteps,
  });
  if (!initialStep) {
    console.log("No initialStep was provided!");
    return { step: "internalError", data: null, event: null };
  }
  let result;
  try {
    for await (const next of controlFlowInstance) {
      result = next;
    }
  } catch (error) {
    // Error occurred in the controlFlow application logic and not the steps
    console.log(error);
    result = { step: "internalError", data: null, event: null };
  }
  return result;
}
