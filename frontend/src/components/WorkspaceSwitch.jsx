import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { Segmented } from './ui.jsx'

export default function WorkspaceSwitch({ current }) {
  const navigate = useNavigate()
  return <Segmented className="seg-range" value={current}
    options={[
      { value: '/home', label: t('Training'), icon: 'dumbbell' },
      { value: '/nutrition', label: t('Nutrition'), icon: 'utensils' },
    ]}
    onChange={path => { if (path !== current) navigate(path) }} />
}
