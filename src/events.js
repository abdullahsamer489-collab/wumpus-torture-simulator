// Tiny event emitter: game.events.on(name, fn) -> unsubscribe, emit(name, data).
export function createEvents() {
  const map = new Map();
  return {
    on(name, fn) {
      let set = map.get(name);
      if (!set) map.set(name, (set = new Set()));
      set.add(fn);
      return () => set.delete(fn);
    },
    off(name, fn) {
      map.get(name)?.delete(fn);
    },
    once(name, fn) {
      const off = this.on(name, (d) => {
        off();
        fn(d);
      });
      return off;
    },
    emit(name, data) {
      const set = map.get(name);
      if (!set) return;
      for (const fn of [...set]) {
        try {
          fn(data);
        } catch (err) {
          console.error(`[events] handler for "${name}" threw`, err);
        }
      }
    },
  };
}
