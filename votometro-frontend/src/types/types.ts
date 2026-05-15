export type Municipality = {
    code: string;
    name: string;
};

export type Department = {
    name: string;
    municipalities: Municipality[];
};

export type DepartmentsRecord = Record<string, Department>;