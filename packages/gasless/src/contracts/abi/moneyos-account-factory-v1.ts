export const moneyOSAccountFactoryV1Abi = [
  {
    type: "function",
    name: "computeAccountAddress",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "salt", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "deployAccount",
    stateMutability: "nonpayable",
    inputs: [
      { name: "owner", type: "address" },
      { name: "salt", type: "bytes32" },
    ],
    outputs: [{ name: "account", type: "address" }],
  },
  {
    type: "function",
    name: "deployAndExecute",
    stateMutability: "payable",
    inputs: [
      { name: "owner", type: "address" },
      { name: "salt", type: "bytes32" },
      {
        name: "intent",
        type: "tuple",
        components: [
          { name: "account", type: "address" },
          { name: "sponsor", type: "address" },
          { name: "nonceKey", type: "uint192" },
          { name: "nonceSeq", type: "uint64" },
          { name: "validAfter", type: "uint48" },
          { name: "validUntil", type: "uint48" },
          {
            name: "calls",
            type: "tuple[]",
            components: [
              { name: "target", type: "address" },
              { name: "value", type: "uint256" },
              { name: "data", type: "bytes" },
            ],
          },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [
      { name: "account", type: "address" },
      { name: "results", type: "bytes[]" },
    ],
  },
] as const;
