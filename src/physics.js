// Rapier setup: world, collision groups, collider tags, contact events, ray casts and props.
import RAPIER from '@dimforge/rapier3d-compat';

export const FIXED_DT = 1 / 120;
export const GRAVITY = -13;

// Collision membership bits.
export const G = {
  WORLD: 1,
  PROP: 2,
  HEAD: 4,
  TORSO: 8,
  PELVIS: 16,
  LIMB: 32, // arms and forearms
  LEG: 64,
  DEBRIS: 128,
};
const ALL = 0xffff;
export const groups = (member, filter) => (((member & 0xffff) << 16) | (filter & 0xffff)) >>> 0;

export async function initRapier() {
  await RAPIER.init();
  return RAPIER;
}

const _v = { x: 0, y: 0, z: 0 };

export function createPhysics(THREE, scene) {
  const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  world.timestep = FIXED_DT;
  world.numSolverIterations = 10;
  const eventQueue = new RAPIER.EventQueue(true);

  const tags = new Map(); // collider handle -> info { kind: 'world'|'seg'|'prop', ... }
  const tracked = new Map(); // body handle -> { body, v: {x,y,z} } pre-step velocity snapshots
  const props = new Set();
  const contactListeners = [];

  const physics = {
    world,
    RAPIER,
    props,
    tags,
    tag(collider, info) {
      tags.set(collider.handle, info);
      return collider;
    },
    untag(collider) {
      tags.delete(collider.handle);
    },
    tagOf(collider) {
      return collider ? tags.get(collider.handle) || null : null;
    },
    track(body) {
      tracked.set(body.handle, { body, v: { x: 0, y: 0, z: 0 } });
    },
    untrack(body) {
      tracked.delete(body.handle);
    },
    onContact(fn) {
      contactListeners.push(fn);
    },

    // Velocity of a body at a world point (linvel + angvel x r).
    velocityAt(body, p) {
      const v = body.linvel();
      const w = body.angvel();
      const c = body.worldCom();
      const rx = p.x - c.x;
      const ry = p.y - c.y;
      const rz = p.z - c.z;
      return { x: v.x + w.y * rz - w.z * ry, y: v.y + w.z * rx - w.x * rz, z: v.z + w.x * ry - w.y * rx };
    },

    step() {
      for (const t of tracked.values()) {
        const v = t.body.linvel();
        t.v.x = v.x;
        t.v.y = v.y;
        t.v.z = v.z;
      }
      world.step(eventQueue);
      eventQueue.drainCollisionEvents((h1, h2, started) => {
        if (!started) return;
        const c1 = world.getCollider(h1);
        const c2 = world.getCollider(h2);
        if (!c1 || !c2) return;
        const t1 = tags.get(h1);
        const t2 = tags.get(h2);
        const b1 = c1.parent();
        const b2 = c2.parent();
        const a = b1 && tracked.get(b1.handle);
        const b = b2 && tracked.get(b2.handle);
        const va = a ? a.v : b1 ? b1.linvel() : _v;
        const vb = b ? b.v : b2 ? b2.linvel() : _v;
        const speed = Math.hypot(va.x - vb.x, va.y - vb.y, va.z - vb.z);
        if (speed < 0.6) return;
        let point = null;
        let normal = null;
        world.contactPair(c1, c2, (manifold) => {
          if (point || manifold.numSolverContacts() === 0) return;
          const p = manifold.solverContactPoint(0);
          point = { x: p.x, y: p.y, z: p.z };
          const n = manifold.normal();
          normal = { x: n.x, y: n.y, z: n.z };
        });
        if (!point) {
          const tr = (b1 || b2).translation();
          point = { x: tr.x, y: tr.y, z: tr.z };
        }
        for (const fn of contactListeners) fn({ a: t1, b: t2, ca: c1, cb: c2, speed, point, normal });
      });
    },

    // Ray cast against everything for which predicate(tagInfo, collider) is truthy.
    raycast(origin, dir, maxToi, accept) {
      const ray = new RAPIER.Ray(origin, dir);
      const hit = world.castRayAndGetNormal(ray, maxToi, true, undefined, undefined, undefined, undefined, (col) => {
        const t = tags.get(col.handle);
        return accept ? accept(t, col) : true;
      });
      if (!hit) return null;
      return {
        collider: hit.collider,
        tag: tags.get(hit.collider.handle) || null,
        toi: hit.timeOfImpact ?? hit.toi,
        point: { x: origin.x + dir.x * hit.timeOfImpact, y: origin.y + dir.y * hit.timeOfImpact, z: origin.z + dir.z * hit.timeOfImpact },
        normal: hit.normal,
      };
    },

    dispose() {
      try {
        world.free();
      } catch {
        /* already freed */
      }
    },
  };

  // ------------------------------------------------------------------------------------ props
  const tmpBox = new THREE.Box3();
  const tmpV = new THREE.Vector3();

  function extents(size, dflt) {
    if (size == null) return dflt;
    if (typeof size === 'number') return [size, size, size];
    if (Array.isArray(size)) return [size[0], size[1] ?? size[0], size[2] ?? size[0]];
    return [size.x ?? size.w ?? dflt[0], size.y ?? size.h ?? dflt[1], size.z ?? size.d ?? dflt[2]];
  }

  function colliderDesc(shape, size, bboxSize) {
    switch (shape) {
      case 'ball': {
        const r = typeof size === 'number' ? size : Array.isArray(size) ? size[0] : size?.r ?? size?.radius ?? Math.max(bboxSize[0], bboxSize[1], bboxSize[2]) / 2;
        return RAPIER.ColliderDesc.ball(r);
      }
      case 'capsule': {
        // size: [radius, total length along y]
        const r = Array.isArray(size) ? size[0] : size?.r ?? size?.radius ?? Math.min(bboxSize[0], bboxSize[2]) / 2;
        const len = Array.isArray(size) ? size[1] ?? r * 4 : size?.h ?? size?.height ?? size?.length ?? bboxSize[1];
        return RAPIER.ColliderDesc.capsule(Math.max(0.005, len / 2 - r), r);
      }
      case 'cylinder': {
        const r = Array.isArray(size) ? size[0] : size?.r ?? size?.radius ?? Math.min(bboxSize[0], bboxSize[2]) / 2;
        const len = Array.isArray(size) ? size[1] ?? r * 2 : size?.h ?? size?.height ?? size?.length ?? bboxSize[1];
        return RAPIER.ColliderDesc.cylinder(len / 2, r);
      }
      case 'box':
      default: {
        const e = extents(size, bboxSize);
        return RAPIER.ColliderDesc.cuboid(Math.max(0.005, e[0] / 2), Math.max(0.005, e[1] / 2), Math.max(0.005, e[2] / 2));
      }
    }
  }

  // spawnProp({ mesh, shape, size, mass, position, velocity, onHit, ... }) -> prop
  //   size: box = [w,h,d] full extents (or one number); ball = radius; capsule/cylinder = [radius, total length].
  //   Missing size is fitted to the mesh bounding box. colliders: [{ shape, size, offset:[x,y,z] }] builds a compound.
  physics.spawnProp = function spawnProp(opts = {}) {
    const mesh = opts.mesh;
    const root = new THREE.Group();
    root.name = 'prop';
    scene.add(root);
    let center = tmpV.set(0, 0, 0);
    let bbox = [0.2, 0.2, 0.2];
    if (mesh) {
      // Keep the world transform the caller gave the mesh, then move it under the prop root.
      mesh.updateWorldMatrix(true, false);
      const wp = new THREE.Vector3();
      const wq = new THREE.Quaternion();
      mesh.getWorldPosition(wp);
      mesh.getWorldQuaternion(wq);
      const parent = mesh.parent;
      if (parent) parent.remove(mesh);
      const pos0 = opts.position ? new THREE.Vector3(opts.position.x, opts.position.y, opts.position.z) : wp;
      root.position.copy(pos0);
      root.quaternion.copy(opts.quaternion ? new THREE.Quaternion(opts.quaternion.x, opts.quaternion.y, opts.quaternion.z, opts.quaternion.w) : wq);
      mesh.position.set(0, 0, 0);
      mesh.quaternion.identity();
      root.add(mesh);
      root.updateMatrixWorld(true);
      // Bounding box in the prop's own frame.
      root.position.set(0, 0, 0);
      const q = root.quaternion.clone();
      root.quaternion.identity();
      root.updateMatrixWorld(true);
      tmpBox.setFromObject(mesh);
      root.quaternion.copy(q);
      root.position.copy(pos0);
      root.updateMatrixWorld(true);
      if (!tmpBox.isEmpty()) {
        bbox = [tmpBox.max.x - tmpBox.min.x, tmpBox.max.y - tmpBox.min.y, tmpBox.max.z - tmpBox.min.z];
        center = tmpBox.getCenter(new THREE.Vector3());
      }
    } else if (opts.position) {
      root.position.set(opts.position.x, opts.position.y, opts.position.z);
    }
    const q = root.quaternion;
    const bd = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(root.position.x, root.position.y, root.position.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinearDamping(opts.linearDamping ?? (opts.soft ? 0.35 : 0.06))
      .setAngularDamping(opts.angularDamping ?? (opts.soft ? 1.2 : 0.25))
      .setCcdEnabled(opts.ccd ?? true);
    const body = world.createRigidBody(bd);
    const specs = opts.colliders || [{ shape: opts.shape || 'box', size: opts.size, offset: [center.x, center.y, center.z] }];
    const mass = opts.mass ?? 1;
    const restitution = opts.restitution ?? (opts.soft ? 0.5 : 0.35);
    const friction = opts.friction ?? 0.7;
    const cols = [];
    const prop = { root, mesh, body, colliders: cols, shape: opts.shape || 'box', mass, onHit: opts.onHit || null, alive: true, userData: opts.userData || {}, soft: !!opts.soft, radius: Math.max(bbox[0], bbox[2]) / 2, squash: null };
    for (const s of specs) {
      const desc = colliderDesc(s.shape || 'box', s.size, bbox);
      const o = s.offset || [0, 0, 0];
      desc
        .setTranslation(o[0], o[1], o[2])
        .setMass(mass / specs.length)
        .setRestitution(restitution)
        .setFriction(friction)
        .setCollisionGroups(groups(opts.membership ?? G.PROP, opts.filter ?? ALL))
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      if (s.rotation) desc.setRotation(s.rotation);
      const col = world.createCollider(desc, body);
      physics.tag(col, { kind: 'prop', prop });
      cols.push(col);
    }
    physics.track(body);
    if (opts.velocity) body.setLinvel(opts.velocity, true);
    if (opts.angularVelocity) body.setAngvel(opts.angularVelocity, true);
    props.add(prop);
    return prop;
  };

  physics.removeProp = function removeProp(prop) {
    if (!prop || !prop.alive) return;
    prop.alive = false;
    props.delete(prop);
    for (const c of prop.colliders) physics.untag(c);
    physics.untrack(prop.body);
    try {
      world.removeRigidBody(prop.body);
    } catch {
      /* already removed */
    }
    prop.root.parent?.remove(prop.root);
    prop.blob?.remove?.();
    prop.onRemove?.(prop);
  };

  physics.syncProps = function syncProps(dt) {
    for (const p of props) {
      const t = p.body.translation();
      const r = p.body.rotation();
      p.root.position.set(t.x, t.y, t.z);
      p.root.quaternion.set(r.x, r.y, r.z, r.w);
      if (p.squash) {
        // squash pulse: damped spring on the scale along the impact normal
        const s = p.squash;
        s.v += (-s.k * s.x - s.c * s.v) * dt;
        s.x += s.v * dt;
        if (Math.abs(s.x) < 0.002 && Math.abs(s.v) < 0.02) {
          p.squash = null;
          p.root.scale.set(1, 1, 1);
        } else {
          const a = 1 + s.x;
          const b = 1 / Math.sqrt(Math.max(0.3, a));
          p.root.scale.set(b, a, b);
        }
      }
      if (p.blob) p.blob.update(t.x, t.y, t.z);
      if (t.y < -30) physics.removeProp(p);
    }
  };

  return physics;
}
