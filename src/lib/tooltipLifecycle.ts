type TooltipOwner = object
type Request = { owner: TooltipOwner; hide: () => void; timer: ReturnType<typeof setTimeout> | undefined }

/** Hover and keyboard focus compete for one explanation, including its delay.
 * Owner identity fences late leave/blur/unmount; request identity fences a
 * cancelled timer even if its callback has already entered the task queue. */
export function createTooltipLifecycle() {
  let current: Request | undefined
  const cancel = (owner: TooltipOwner, hide = true) => {
    if (current?.owner !== owner) return
    const request = current
    current = undefined
    clearTimeout(request.timer)
    if (hide) request.hide()
  }
  return {
    open(owner: TooltipOwner, show: () => void, hide: () => void, delay: number) {
      if (current?.owner === owner) clearTimeout(current.timer)
      else if (current) cancel(current.owner)
      const request: Request = { owner, hide, timer: undefined }
      current = request
      request.timer = setTimeout(() => {
        if (current !== request) return
        request.timer = undefined
        show()
      }, delay)
    },
    cancel,
  }
}

export const tooltipLifecycle = createTooltipLifecycle()
