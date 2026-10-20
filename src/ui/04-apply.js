const inject = ['slots', 'locale', 'remote', 'remote.credentials', 'configForms']

    function apply(ctx) {
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-memory: dictionaries')
        const controller = new MemoryPageController(ctx)
        ctx.effect(
          () => () => {
            controller.dispose()
          },
          'dsh-memory: settings controller',
        )
        ctx.effect(
          () =>
            ctx.slots.inject('settings.section', () =>
              ctx.slots.register(
                {
                  name: 'settings.section',
                  id: 'memory',
                  order: 35,
                  label: () => t('nav'),
                  locale: NS,
                  inject: () => controller.inject(),
                },
                MemorySection,
              ),
            ),
          'dsh-memory: settings page',
        )
    }
