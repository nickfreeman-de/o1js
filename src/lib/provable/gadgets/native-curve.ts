import type { Field } from '../field.js';
import type { Bool } from '../bool.js';
import { Fp, Fq } from '../../../bindings/crypto/finite-field.js';
import { PallasAffine } from '../../../bindings/crypto/elliptic-curve.js';
import { fieldToField3 } from './comparison.js';
import { Field3, ForeignField } from './foreign-field.js';
import { exists, existsOne } from '../core/exists.js';
import { bit, isConstant, packBits } from './common.js';
import { TupleN } from '../../util/types.js';
import { l } from './range-check.js';
import { createField, getField } from '../core/field-constructor.js';
import { Snarky } from '../../../snarky.js';
import { Provable } from '../provable.js';
import { MlPair } from '../../ml/base.js';
import { provable } from '../types/provable-derivers.js';

export {
  scale,
  fieldToShiftedScalar,
  field3ToShiftedScalar,
  scaleShiftedSplit5,
  add,
};

type Point = { x: Field; y: Field };
type ShiftedScalar = { low5: TupleN<Bool, 5>; high250: Field };

/**
 * Gadget to scale a point by a scalar, where the scalar is represented as a _native_ Field.
 */
function scale(P: Point, s: Field): Point {
  // constant case
  let { x, y } = P;
  if (x.isConstant() && y.isConstant() && s.isConstant()) {
    let sP = PallasAffine.scale(
      PallasAffine.fromNonzero({ x: x.toBigInt(), y: y.toBigInt() }),
      s.toBigInt()
    );
    return { x: createField(sP.x), y: createField(sP.y) };
  }
  // compute t = s - 2^254 mod q using foreign field subtraction, and split into 5 low bits and 250 high bits
  let t = fieldToShiftedScalar(s);

  // return (t + 2^254)*P = (s - 2^254 + 2^254)*P = s*P
  return scaleShiftedSplit5(P, t);
}

/**
 * Converts a field element s to a shifted representation t = s = 2^254 mod q,
 * where t is represented as a 5-bit low part and a 250-bit high part.
 *
 * This is the representation we use for scalars, since it can be used as input to `scaleShiftedSplit5()`.
 */
function fieldToShiftedScalar(s: Field): ShiftedScalar {
  return field3ToShiftedScalar(fieldToField3(s));
}

/**
 * Converts a 3-limb bigint to a shifted representation t = s = 2^254 mod q,
 * where t is represented as a 5-bit low part and a 250-bit high part.
 */
function field3ToShiftedScalar(s: Field3): ShiftedScalar {
  // constant case
  if (Field3.isConstant(s)) {
    let t = Fq.mod(Field3.toBigint(s) - (1n << 254n));
    let low5 = createField(t & 0x1fn).toBits(5);
    let high250 = createField(t >> 5n);
    return { low5: TupleN.fromArray(5, low5), high250 };
  }

  // compute t = s - 2^254 mod q using foreign field subtraction
  let twoTo254 = Field3.from(1n << 254n);
  let [t0, t1, t2] = ForeignField.sub(s, twoTo254, Fq.modulus);

  // split t into 250 high bits and 5 low bits
  // => split t0 into [5, 83]
  let tLo = exists(5, () => {
    let t = t0.toBigInt();
    return [bit(t, 0), bit(t, 1), bit(t, 2), bit(t, 3), bit(t, 4)];
  });
  let tLoBools = TupleN.map(tLo, (x) => x.assertBool());
  let tHi0 = existsOne(() => t0.toBigInt() >> 5n);

  // prove split
  // since we know that t0 < 2^88, this proves that t0High < 2^83
  packBits(tLo)
    .add(tHi0.mul(1n << 5n))
    .assertEquals(t0);

  // pack tHi
  // proves that tHi is in [0, 2^250)
  let tHi = tHi0
    .add(t1.mul(1n << (l - 5n)))
    .add(t2.mul(1n << (2n * l - 5n)))
    .seal();

  return { low5: tLoBools, high250: tHi };
}

/**
 * Internal helper to compute `(t + 2^254)*P`.
 * `t` is expected to be split into 250 high bits (t >> 5) and 5 low bits (t & 0x1f).
 *
 * The gadget proves that `tHi` is in [0, 2^250) but assumes that `tLo` consists of bits.
 */
function scaleShiftedSplit5(
  { x, y }: Point,
  { low5: tLo, high250: tHi }: ShiftedScalar
): Point {
  // constant case
  if (isConstant(x, y, tHi, ...tLo)) {
    let sP = PallasAffine.scale(
      PallasAffine.fromNonzero({ x: x.toBigInt(), y: y.toBigInt() }),
      Fq.add(packBits(tLo).toBigInt() + (tHi.toBigInt() << 5n), 1n << 254n)
    );
    return { x: createField(sP.x), y: createField(sP.y) };
  }
  const Field = getField();
  const Point = provable({ x: Field, y: Field });
  const zero = createField(0n);

  // R = (2*(t >> 5) + 1 + 2^250)P
  let [, RMl] = Snarky.group.scaleFastUnpack(
    [0, x.value, y.value],
    [0, tHi.value],
    250
  );
  let P = { x, y };
  let R = { x: createField(RMl[1]), y: createField(RMl[2]) };
  let [t0, t1, t2, t3, t4] = tLo;

  // R = t4 ? R : R - P = ((t >> 4) + 2^250)P
  R = Provable.if(t4, Point, R, addNonZero(R, negate(P)));

  // R = ((t >> 3) + 2^251)P
  // R = ((t >> 2) + 2^252)P
  // R = ((t >> 1) + 2^253)P
  for (let t of [t3, t2, t1]) {
    R = addNonZero(R, R);
    R = Provable.if(t, Point, addNonZero(R, P), R);
  }

  // R = (t + 2^254)P
  // in the final step, we allow a zero output to make it work for the 0 scalar
  R = addNonZero(R, R);
  let { result, isInfinity } = add(R, P);
  result = Provable.if(isInfinity, Point, { x: zero, y: zero }, result);
  R = Provable.if(t0, Point, result, R);

  return R;
}

/**
 * Wraps the `EC_add` gate to perform complete addition of two non-zero curve points.
 */
function add(g: Point, h: Point): { result: Point; isInfinity: Bool } {
  // compute witnesses
  let witnesses = exists(7, () => {
    let x1 = g.x.toBigInt();
    let y1 = g.y.toBigInt();
    let x2 = h.x.toBigInt();
    let y2 = h.y.toBigInt();

    let sameX = BigInt(x1 === x2);
    let inf = BigInt(sameX && y1 !== y2);
    let infZ = sameX ? Fp.inverse(y2 - y1) ?? 0n : 0n;
    let x21Inv = Fp.inverse(x2 - x1) ?? 0n;

    let slopeDouble = Fp.div(3n * x1 ** 2n, 2n * y1) ?? 0n;
    let slopeAdd = Fp.mul(y2 - y1, x21Inv);
    let s = sameX ? slopeDouble : slopeAdd;

    let x3 = Fp.mod(s ** 2n - x1 - x2);
    let y3 = Fp.mod(s * (x1 - x3) - y1);

    return [sameX, inf, infZ, x21Inv, s, x3, y3];
  });

  let [same_x, inf, inf_z, x21_inv, s, x3, y3] = witnesses;
  let isInfinity = inf.assertBool();

  Snarky.gates.ecAdd(
    MlPair(g.x.seal().value, g.y.seal().value),
    MlPair(h.x.seal().value, h.y.seal().value),
    MlPair(x3.value, y3.value),
    inf.value,
    same_x.value,
    s.value,
    inf_z.value,
    x21_inv.value
  );

  return { result: { x: x3, y: y3 }, isInfinity };
}

/**
 * Addition that asserts the result is non-zero.
 */
function addNonZero(g: Point, h: Point) {
  let { result, isInfinity } = add(g, h);
  isInfinity.assertFalse();
  return result;
}

/**
 * Negates a point.
 */
function negate(g: Point): Point {
  return { x: g.x, y: g.y.neg() };
}
