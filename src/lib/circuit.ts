import { snarkContext } from './proof_system.js';
import {
  Field,
  Keypair,
  ProvablePure,
  SnarkyProof,
  SnarkyVerificationKey,
} from '../snarky.js';
import { SnarkyCircuit } from './circuit_value.js';
import { withThreadPool } from '../bindings/js/wrapper.js';
import { Provable } from './provable.js';

// external API
export { public_, circuitMain, Circuit };

class Circuit {
  // circuit-writing interface

  /**
   * Generates a proving key and a verification key for this circuit.
   * @example
   * ```ts
   * const keypair = await Circuit.generateKeypair();
   * ```
   */
  static generateKeypair() {
    return withThreadPool(async () =>
      SnarkyCircuit.generateKeypair(this as any)
    );
  }

  /**
   * Proves a statement using the private input, public input, and the {@link Keypair} of the circuit.
   * @example
   * ```ts
   * const keypair = await Circuit.generateKeypair();
   * const proof = await Circuit.prove(privateInput, publicInput, keypair);
   * ```
   */
  static prove(privateInput: any[], publicInput: any[], keypair: Keypair) {
    return withThreadPool(async () =>
      SnarkyCircuit.prove(this as any, privateInput, publicInput, keypair)
    );
  }

  /**
   * Verifies a proof using the public input, the proof, and the initial {@link Keypair} of the circuit.
   * @example
   * ```ts
   * const keypair = await Circuit.generateKeypair();
   * const proof = await Circuit.prove(privateInput, publicInput, keypair);
   * const isValid = await Circuit.verify(publicInput, keypair.vk, proof);
   * ```
   */
  static verify(
    publicInput: any[],
    vk: SnarkyVerificationKey,
    proof: SnarkyProof
  ) {
    return withThreadPool(async () =>
      SnarkyCircuit.verify(publicInput, vk, proof)
    );
  }

  // utility namespace

  /**
   * @deprecated use {@link Provable.witness}
   */
  static witness = Provable.witness;
  /**
   * @deprecated use {@link Provable.asProver}
   */
  static asProver = Provable.asProver;
  /**
   * @deprecated use {@link Provable.runAndCheck}
   */
  static runAndCheck = Provable.runAndCheck;
  /**
   * @deprecated use {@link Provable.runUnchecked}
   */
  static runUnchecked = Provable.runUnchecked;
  /**
   * @deprecated use {@link Provable.constraintSystem}
   */
  static constraintSystem = Provable.constraintSystem;
  /**
   * @deprecated use {@link Provable.constraintSystemFromKeypair}
   */
  static constraintSystemFromKeypair = Provable.constraintSystemFromKeypair;
  /**
   * Creates a {@link Provable} for a generic array.
   * @example
   * ```ts
   * const ProvableArray = Circuit.array(Field, 5);
   * ```
   */
  static array = SnarkyCircuit.array;
  /**
   * Asserts that two values are equal.
   * @example
   * ```ts
   * class MyStruct extends Struct({ a: Field, b: Bool }) {};
   * const a: MyStruct = { a: Field(0), b: Bool(false) };
   * const b: MyStruct = { a: Field(1), b: Bool(true) };
   * Circuit.assertEqual(MyStruct, a, b);
   * ```
   */
  static assertEqual = SnarkyCircuit.assertEqual;
  /**
   * Checks if two elements are equal.
   * @example
   * ```ts
   * class MyStruct extends Struct({ a: Field, b: Bool }) {};
   * const a: MyStruct = { a: Field(0), b: Bool(false) };
   * const b: MyStruct = { a: Field(1), b: Bool(true) };
   * const isEqual = Circuit.equal(MyStruct, a, b);
   * ```
   */
  static equal = SnarkyCircuit.equal;
  /**
   * Circuit-compatible if-statement.
   * @example
   * ```ts
   * const condition = Bool(true);
   * const result = Circuit.if(condition, Field(1), Field(2)); // Returns Field(1)
   * ```
   */
  static if = SnarkyCircuit.if;
  /**
   * Generalization of `Circuit.if` for choosing between more than two different cases.
   * It takes a "mask", which is an array of `Bool`s that contains only one `true` element, a type/constructor, and an array of values of that type.
   * The result is that value which corresponds to the true element of the mask.
   * @example
   * ```ts
   * let x = Circuit.switch([Bool(false), Bool(true)], Field, [Field(1), Field(2)]);
   * x.assertEquals(2);
   * ```
   */
  static switch = SnarkyCircuit.switch;
  /**
   * Serializes an element into {@link Field} elements.
   * @example
   * ```ts
   * const element = Field(42);
   * const fields = Circuit.toFields(element);
   * ```
   */
  static toFields = SnarkyCircuit.toFields;
  /**
   * Checks if the circuit is in prover mode.
   * @example
   * ```ts
   * if (Circuit.inProver()) {
   *   // Prover-specific code
   * }
   * ```
   */
  static inProver = SnarkyCircuit.inProver;
  /**
   * Checks if the circuit is in checked computation mode.
   * @example
   * ```ts
   * if (Circuit.inCheckedComputation()) {
   *   // Checked computation-specific code
   * }
   * ```
   */
  static inCheckedComputation = SnarkyCircuit.inCheckedComputation;
  /**
   * Interface to log elements within a circuit. Similar to `console.log()`.
   * @example
   * ```ts
   * const element = Field(42);
   * Circuit.log(element);
   * ```
   */
  static log = SnarkyCircuit.log;
}

function public_(target: any, _key: string | symbol, index: number) {
  // const fieldType = Reflect.getMetadata('design:paramtypes', target, key);

  if (target._public === undefined) {
    target._public = [];
  }
  target._public.push(index);
}

function provableFromTuple(typs: ProvablePure<any>[]): ProvablePure<any> {
  return {
    sizeInFields: () => {
      return typs.reduce((acc, typ) => acc + typ.sizeInFields(), 0);
    },

    toFields: (t: Array<any>) => {
      if (t.length !== typs.length) {
        throw new Error(`typOfArray: Expected ${typs.length}, got ${t.length}`);
      }

      let res = [];
      for (let i = 0; i < t.length; ++i) {
        res.push(...typs[i].toFields(t[i]));
      }
      return res;
    },

    toAuxiliary() {
      return [];
    },

    fromFields: (xs: Array<any>) => {
      let offset = 0;
      let res: Array<any> = [];
      typs.forEach((typ) => {
        const n = typ.sizeInFields();
        res.push(typ.fromFields(xs.slice(offset, offset + n)));
        offset += n;
      });
      return res;
    },

    check(xs: Array<any>) {
      typs.forEach((typ, i) => (typ as any).check(xs[i]));
    },
  };
}

function circuitMain(
  target: any,
  propertyName: string,
  _descriptor?: PropertyDescriptor
): any {
  const paramTypes = Reflect.getMetadata(
    'design:paramtypes',
    target,
    propertyName
  );
  const numArgs = paramTypes.length;

  const publicIndexSet: Set<number> = new Set(target._public);
  const witnessIndexSet: Set<number> = new Set();
  for (let i = 0; i < numArgs; ++i) {
    if (!publicIndexSet.has(i)) {
      witnessIndexSet.add(i);
    }
  }

  target.snarkyMain = (w: Array<any>, pub: Array<any>) => {
    let [, result] = snarkContext.runWith(
      { inCheckedComputation: true },
      () => {
        let args = [];
        for (let i = 0; i < numArgs; ++i) {
          args.push((publicIndexSet.has(i) ? pub : w).shift());
        }

        return target[propertyName].apply(target, args);
      }
    );
    return result;
  };

  target.snarkyWitnessTyp = provableFromTuple(
    Array.from(witnessIndexSet).map((i) => paramTypes[i])
  );
  target.snarkyPublicTyp = provableFromTuple(
    Array.from(publicIndexSet).map((i) => paramTypes[i])
  );
}
