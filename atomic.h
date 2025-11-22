#ifndef ATOMIC_H
#define ATOMIC_H

#ifdef __cplusplus
extern "C" {
#endif

// Estrutura simplificada para operações atômicas
typedef struct {
    volatile int counter;
} atomic_t;

// Funções inline para operações atômicas básicas
static inline void atomic_set(atomic_t *v, int i)
{
    v->counter = i;
}

static inline int atomic_read(const atomic_t *v)
{
    return v->counter;
}

static inline void atomic_add(int i, atomic_t *v)
{
    v->counter += i;
}

static inline void atomic_sub(int i, atomic_t *v)
{
    v->counter -= i;
}

static inline void atomic_inc(atomic_t *v)
{
    atomic_add(1, v);
}

static inline void atomic_dec(atomic_t *v)
{
    atomic_sub(1, v);
}

#ifdef __cplusplus
}
#endif

#endif /* ATOMIC_H */