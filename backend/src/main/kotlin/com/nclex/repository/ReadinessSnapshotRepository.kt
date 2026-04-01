package com.nclex.repository

import com.nclex.model.ReadinessSnapshot
import org.springframework.data.jpa.repository.JpaRepository
import java.time.LocalDate
import java.util.UUID

interface ReadinessSnapshotRepository : JpaRepository<ReadinessSnapshot, UUID> {
    fun findByUserIdAndSnapshotDateBetweenOrderBySnapshotDateAsc(
        userId: UUID, from: LocalDate, to: LocalDate
    ): List<ReadinessSnapshot>

    fun findByUserIdAndSnapshotDate(userId: UUID, date: LocalDate): ReadinessSnapshot?

    fun findByUserIdOrderBySnapshotDateDesc(userId: UUID): List<ReadinessSnapshot>
}
