/// <reference types="node" />

declare module 'permissionless/accounts' {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  export interface SmartAccountSigner<
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    TSource extends string = string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    TAddress extends Address = Address,
  > {}
}

declare module 'permissionless/types' {
  export type EntryPoint = string
}
