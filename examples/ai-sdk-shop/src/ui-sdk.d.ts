import type { HTMLAttributes, Ref } from 'react'

type Part = HTMLAttributes<HTMLElement> & { ref?: Ref<HTMLElement> }

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'ui-dialog': Omit<Part, 'ref'> & { ref?: Ref<HTMLElement & { open: boolean }> }
      'ui-dialog-backdrop': Part
      'ui-dialog-content': Part
      'ui-dialog-description': Part
      'ui-dialog-title': Part
      'ui-input': Part
    }
  }
}
