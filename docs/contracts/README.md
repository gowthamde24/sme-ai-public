# UI contracts

Lane B proposes versioned request/response schemas, error cases and synthetic examples in B/ before UI work. Lane A reviews the contract and implements the endpoint; generated packages/contracts remains lane A-owned. Lane B uses a mock until that endpoint exists. Contract files are proposals, not proof of live functionality. No keys, real data, auth policy or database writes in mocks.
