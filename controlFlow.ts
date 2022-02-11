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
}: ControlFlowArgs<T>): AsyncGenerator<ControlFlowReturn> {
  let currentStep = initialStep;
  let currentConfig = steps[currentStep];
  while (true) {
    if (currentConfig.final) {
      return;
    }
    let data = await currentConfig.entry(stepContext);
    let nextEvent = data.nextEvent;
    delete data.nextEvent;
    let next = { step: currentConfig[nextEvent], data, event: nextEvent };
    currentStep = next.step;
    currentConfig = steps[currentStep];
    yield next;
  }
}

export default async function controlFlow<T>({
  initialStep,
  steps,
  stepContext,
}: ControlFlowArgs<T>): Promise<ControlFlowReturn> {
  const controlFlowInstance = createControlFlow<T>({
    initialStep,
    steps,
    stepContext,
  });
  let result;
  for await (const next of controlFlowInstance) {
    result = next;
  }
  return result;
}
