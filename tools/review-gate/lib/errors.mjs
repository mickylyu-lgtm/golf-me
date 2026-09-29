// Transport failure kinds shared by the mock and real reviewer transports.
//   timeout | network | crash -> transient, retried within the limits
//   disabled                  -> real calls switched off; reviewer UNAVAILABLE
//   config                    -> missing/invalid local configuration (e.g. no key); BLOCKED, never retried
export class TransportError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}
