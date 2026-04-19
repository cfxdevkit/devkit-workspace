import {
  createReadContract,
  createWriteContract,
  createSimulateContract,
  createWatchContractEvent,
} from 'wagmi/codegen'

import {
  createUseReadContract,
  createUseWriteContract,
  createUseSimulateContract,
  createUseWatchContractEvent,
} from 'wagmi/codegen'

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ExampleCounter
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const exampleCounterAbi = [
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'account',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'unlockTimestamp',
        internalType: 'uint64',
        type: 'uint64',
        indexed: false,
      },
    ],
    name: 'FundsLocked',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'account',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'FundsWithdrawn',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'value',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'ValueChanged',
  },
  {
    type: 'function',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'getLock',
    outputs: [
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
      { name: 'unlockTimestamp', internalType: 'uint64', type: 'uint64' },
      { name: 'claimable', internalType: 'bool', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'increment',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'unlockTimestamp', internalType: 'uint64', type: 'uint64' },
    ],
    name: 'lock',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'reset',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'value',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'withdrawLocked',
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Action
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Wraps __{@link readContract}__ with `abi` set to __{@link exampleCounterAbi}__
 */
export const readExampleCounter = /*#__PURE__*/ createReadContract({
  abi: exampleCounterAbi,
})

/**
 * Wraps __{@link readContract}__ with `abi` set to __{@link exampleCounterAbi}__ and `functionName` set to `"getLock"`
 */
export const readExampleCounterGetLock = /*#__PURE__*/ createReadContract({
  abi: exampleCounterAbi,
  functionName: 'getLock',
})

/**
 * Wraps __{@link readContract}__ with `abi` set to __{@link exampleCounterAbi}__ and `functionName` set to `"value"`
 */
export const readExampleCounterValue = /*#__PURE__*/ createReadContract({
  abi: exampleCounterAbi,
  functionName: 'value',
})

/**
 * Wraps __{@link writeContract}__ with `abi` set to __{@link exampleCounterAbi}__
 */
export const writeExampleCounter = /*#__PURE__*/ createWriteContract({
  abi: exampleCounterAbi,
})

/**
 * Wraps __{@link writeContract}__ with `abi` set to __{@link exampleCounterAbi}__ and `functionName` set to `"increment"`
 */
export const writeExampleCounterIncrement = /*#__PURE__*/ createWriteContract({
  abi: exampleCounterAbi,
  functionName: 'increment',
})

/**
 * Wraps __{@link writeContract}__ with `abi` set to __{@link exampleCounterAbi}__ and `functionName` set to `"lock"`
 */
export const writeExampleCounterLock = /*#__PURE__*/ createWriteContract({
  abi: exampleCounterAbi,
  functionName: 'lock',
})

/**
 * Wraps __{@link writeContract}__ with `abi` set to __{@link exampleCounterAbi}__ and `functionName` set to `"reset"`
 */
export const writeExampleCounterReset = /*#__PURE__*/ createWriteContract({
  abi: exampleCounterAbi,
  functionName: 'reset',
})

/**
 * Wraps __{@link writeContract}__ with `abi` set to __{@link exampleCounterAbi}__ and `functionName` set to `"withdrawLocked"`
 */
export const writeExampleCounterWithdrawLocked =
  /*#__PURE__*/ createWriteContract({
    abi: exampleCounterAbi,
    functionName: 'withdrawLocked',
  })

/**
 * Wraps __{@link simulateContract}__ with `abi` set to __{@link exampleCounterAbi}__
 */
export const simulateExampleCounter = /*#__PURE__*/ createSimulateContract({
  abi: exampleCounterAbi,
})

/**
 * Wraps __{@link simulateContract}__ with `abi` set to __{@link exampleCounterAbi}__ and `functionName` set to `"increment"`
 */
export const simulateExampleCounterIncrement =
  /*#__PURE__*/ createSimulateContract({
    abi: exampleCounterAbi,
    functionName: 'increment',
  })

/**
 * Wraps __{@link simulateContract}__ with `abi` set to __{@link exampleCounterAbi}__ and `functionName` set to `"lock"`
 */
export const simulateExampleCounterLock = /*#__PURE__*/ createSimulateContract({
  abi: exampleCounterAbi,
  functionName: 'lock',
})

/**
 * Wraps __{@link simulateContract}__ with `abi` set to __{@link exampleCounterAbi}__ and `functionName` set to `"reset"`
 */
export const simulateExampleCounterReset = /*#__PURE__*/ createSimulateContract(
  { abi: exampleCounterAbi, functionName: 'reset' },
)

/**
 * Wraps __{@link simulateContract}__ with `abi` set to __{@link exampleCounterAbi}__ and `functionName` set to `"withdrawLocked"`
 */
export const simulateExampleCounterWithdrawLocked =
  /*#__PURE__*/ createSimulateContract({
    abi: exampleCounterAbi,
    functionName: 'withdrawLocked',
  })

/**
 * Wraps __{@link watchContractEvent}__ with `abi` set to __{@link exampleCounterAbi}__
 */
export const watchExampleCounterEvent = /*#__PURE__*/ createWatchContractEvent({
  abi: exampleCounterAbi,
})

/**
 * Wraps __{@link watchContractEvent}__ with `abi` set to __{@link exampleCounterAbi}__ and `eventName` set to `"FundsLocked"`
 */
export const watchExampleCounterFundsLockedEvent =
  /*#__PURE__*/ createWatchContractEvent({
    abi: exampleCounterAbi,
    eventName: 'FundsLocked',
  })

/**
 * Wraps __{@link watchContractEvent}__ with `abi` set to __{@link exampleCounterAbi}__ and `eventName` set to `"FundsWithdrawn"`
 */
export const watchExampleCounterFundsWithdrawnEvent =
  /*#__PURE__*/ createWatchContractEvent({
    abi: exampleCounterAbi,
    eventName: 'FundsWithdrawn',
  })

/**
 * Wraps __{@link watchContractEvent}__ with `abi` set to __{@link exampleCounterAbi}__ and `eventName` set to `"ValueChanged"`
 */
export const watchExampleCounterValueChangedEvent =
  /*#__PURE__*/ createWatchContractEvent({
    abi: exampleCounterAbi,
    eventName: 'ValueChanged',
  })

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// React
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link exampleCounterAbi}__
 */
export const useReadExampleCounter = /*#__PURE__*/ createUseReadContract({
  abi: exampleCounterAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link exampleCounterAbi}__ and `functionName` set to `"getLock"`
 */
export const useReadExampleCounterGetLock = /*#__PURE__*/ createUseReadContract(
  { abi: exampleCounterAbi, functionName: 'getLock' },
)

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link exampleCounterAbi}__ and `functionName` set to `"value"`
 */
export const useReadExampleCounterValue = /*#__PURE__*/ createUseReadContract({
  abi: exampleCounterAbi,
  functionName: 'value',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link exampleCounterAbi}__
 */
export const useWriteExampleCounter = /*#__PURE__*/ createUseWriteContract({
  abi: exampleCounterAbi,
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link exampleCounterAbi}__ and `functionName` set to `"increment"`
 */
export const useWriteExampleCounterIncrement =
  /*#__PURE__*/ createUseWriteContract({
    abi: exampleCounterAbi,
    functionName: 'increment',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link exampleCounterAbi}__ and `functionName` set to `"lock"`
 */
export const useWriteExampleCounterLock = /*#__PURE__*/ createUseWriteContract({
  abi: exampleCounterAbi,
  functionName: 'lock',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link exampleCounterAbi}__ and `functionName` set to `"reset"`
 */
export const useWriteExampleCounterReset = /*#__PURE__*/ createUseWriteContract(
  { abi: exampleCounterAbi, functionName: 'reset' },
)

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link exampleCounterAbi}__ and `functionName` set to `"withdrawLocked"`
 */
export const useWriteExampleCounterWithdrawLocked =
  /*#__PURE__*/ createUseWriteContract({
    abi: exampleCounterAbi,
    functionName: 'withdrawLocked',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link exampleCounterAbi}__
 */
export const useSimulateExampleCounter =
  /*#__PURE__*/ createUseSimulateContract({ abi: exampleCounterAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link exampleCounterAbi}__ and `functionName` set to `"increment"`
 */
export const useSimulateExampleCounterIncrement =
  /*#__PURE__*/ createUseSimulateContract({
    abi: exampleCounterAbi,
    functionName: 'increment',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link exampleCounterAbi}__ and `functionName` set to `"lock"`
 */
export const useSimulateExampleCounterLock =
  /*#__PURE__*/ createUseSimulateContract({
    abi: exampleCounterAbi,
    functionName: 'lock',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link exampleCounterAbi}__ and `functionName` set to `"reset"`
 */
export const useSimulateExampleCounterReset =
  /*#__PURE__*/ createUseSimulateContract({
    abi: exampleCounterAbi,
    functionName: 'reset',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link exampleCounterAbi}__ and `functionName` set to `"withdrawLocked"`
 */
export const useSimulateExampleCounterWithdrawLocked =
  /*#__PURE__*/ createUseSimulateContract({
    abi: exampleCounterAbi,
    functionName: 'withdrawLocked',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link exampleCounterAbi}__
 */
export const useWatchExampleCounterEvent =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: exampleCounterAbi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link exampleCounterAbi}__ and `eventName` set to `"FundsLocked"`
 */
export const useWatchExampleCounterFundsLockedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: exampleCounterAbi,
    eventName: 'FundsLocked',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link exampleCounterAbi}__ and `eventName` set to `"FundsWithdrawn"`
 */
export const useWatchExampleCounterFundsWithdrawnEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: exampleCounterAbi,
    eventName: 'FundsWithdrawn',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link exampleCounterAbi}__ and `eventName` set to `"ValueChanged"`
 */
export const useWatchExampleCounterValueChangedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: exampleCounterAbi,
    eventName: 'ValueChanged',
  })
