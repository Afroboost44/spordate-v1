/**
 * Firestore factice — juste ce dont le LOT U2b a besoin, et rien de plus.
 *
 * POURQUOI PAS L'ÉMULATEUR : ce qu'on éprouve ici, ce sont des DÉCISIONS
 * (créer / ne rien faire / refuser d'écraser) et le fait que certains chemins
 * n'écrivent RIEN. Un double en mémoire rend ce « rien » observable — il
 * compte chaque écriture — là où l'émulateur oblige à démontrer une absence.
 * Les tests de règles Firestore, eux, restent sur l'émulateur : ce n'est pas
 * le même sujet.
 *
 * DEUX CONTRAINTES DU VRAI FIRESTORE SONT REPRODUITES, parce qu'un double trop
 * complaisant validerait du code qui casse en production :
 *   1. dans une transaction, toutes les lectures précèdent toutes les
 *      écritures — sinon on lève, comme le vrai ;
 *   2. `create()` échoue si le document existe déjà.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type Ecriture = { op: 'set' | 'create'; chemin: string };

export function creerFirestoreFactice() {
  const donnees = new Map<string, Map<string, any>>();
  const ecritures: Ecriture[] = [];
  let compteurAuto = 0;

  function collection(nom: string): Map<string, any> {
    let m = donnees.get(nom);
    if (!m) {
      m = new Map<string, any>();
      donnees.set(nom, m);
    }
    return m;
  }

  function ref(nomCol: string, id: string) {
    const chemin = `${nomCol}/${id}`;
    return {
      id,
      path: chemin,
      async get() {
        const m = collection(nomCol);
        const present = m.has(id);
        const valeur = m.get(id);
        return { exists: present, id, data: () => (present ? { ...valeur } : undefined) };
      },
      async create(data: any) {
        const m = collection(nomCol);
        if (m.has(id)) throw new Error(`ALREADY_EXISTS: ${chemin}`);
        m.set(id, { ...data });
        ecritures.push({ op: 'create', chemin });
      },
      async set(data: any) {
        collection(nomCol).set(id, { ...data });
        ecritures.push({ op: 'set', chemin });
      },
    };
  }

  const db = {
    collection(nom: string) {
      return {
        doc(id?: string) {
          return ref(nom, id || `auto_${++compteurAuto}`);
        },
      };
    },

    async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
      const differees: Array<() => Promise<void>> = [];
      let dejaEcrit = false;
      const tx = {
        async get(r: any) {
          if (dejaEcrit) throw new Error('Firestore: lecture après écriture dans une transaction');
          return r.get();
        },
        set(r: any, data: any) {
          dejaEcrit = true;
          differees.push(() => r.set(data));
        },
        create(r: any, data: any) {
          dejaEcrit = true;
          differees.push(() => r.create(data));
        },
      };
      const resultat = await fn(tx);
      for (const f of differees) await f();
      return resultat;
    },

    /** Lecture directe, pour les assertions. */
    _lire(nomCol: string, id: string): any | undefined {
      const v = collection(nomCol).get(id);
      return v ? { ...v } : undefined;
    },
    /** Nombre de documents d'une collection. */
    _taille(nomCol: string): number {
      return collection(nomCol).size;
    },
    /** Tous les documents d'une collection, dans l'ordre d'insertion. */
    _tous(nomCol: string): any[] {
      return Array.from(collection(nomCol).values()).map((v) => ({ ...v }));
    },
    /** Journal de TOUTES les écritures — c'est lui qui rend le « rien » visible. */
    _ecritures(): Ecriture[] {
      return ecritures.slice();
    },
  };

  return db;
}
