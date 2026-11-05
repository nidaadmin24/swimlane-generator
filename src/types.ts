export type StepType =
  | 'Start Event'
  | 'Task'
  | 'User Task'
  | 'Service Task'
  | 'Manual Task'
  | 'Decision Point'
  | 'Exclusive Gateway'
  | 'Parallel Gateway'
  | 'End Event'
  | 'Data/Artifact'

export interface SequenceFlow {
  id: string
  targetId: string
  label?: string
  conditionExpression?: string
  isDefault?: boolean
}

export interface Step {
  id: string
  stepName: string
  department: string
  stepType: StepType
  predecessorId: string
  condition: string
  poolId?: string
  poolName?: string
  laneId?: string
  laneName?: string
  sequenceFlows?: SequenceFlow[]
}

export interface ProcessDiagram {
  id: string | number
  title: string
  folder: string
  owner: string | null
  steps: Step[]
  user_id: string
  created_at: string
}

export type Database = {
  public: {
    Tables: {
      process_diagrams: {
        Row: ProcessDiagram
        Insert: {
          id?: string | number
          title: string
          folder?: string
          owner?: string | null
          steps: Step[]
          user_id?: string
          created_at?: string
        }
        Update: {
          id?: string | number
          title?: string
          folder?: string
          owner?: string | null
          steps?: Step[]
          user_id?: string
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}