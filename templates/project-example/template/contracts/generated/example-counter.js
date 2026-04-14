export const exampleCounterArtifact = {
  contractName: 'ExampleCounter',
  chainId: 2030,
  address: null,
  abi: [
    {
      type: 'function',
      name: 'increment',
      stateMutability: 'nonpayable',
      inputs: [],
      outputs: []
    },
    {
      type: 'function',
      name: 'current',
      stateMutability: 'view',
      inputs: [],
      outputs: [{ name: '', type: 'uint256' }]
    }
  ]
};
