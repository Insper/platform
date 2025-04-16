CREATE TABLE order (
    id_order VARCHAR(36) NOT NULL,
    dt_date VARCHAR(256) NOT NULL,
    nr_total FLOAT(256) NOT NULL,
    id_account VARCHAR(64) NOT NULL,
    CONSTRAINT pk_order PRIMARY KEY (id_order)
);
